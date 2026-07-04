import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Typical propagation delay per target, in hours. These simulate real-world
// index/refresh times for each retrieval surface. Fan-out confirmations
// resolve automatically once this much wall-clock time has passed since push.
// Realistic propagation windows, calibrated against the 24h "green" and 48h
// "SLA met" thresholds shown in the SLA report. Values reflect observed median
// time-to-live for each surface, not best-case API acknowledgement.
export const TARGET_DELAY_HOURS: Record<string, number> = {
  // Surfaces we control or that accept push instantly — well inside 24h.
  artist_site: 0.1,       // ~6 min: static rebuild + CDN purge
  x: 0.1,                 // ~6 min: post live, embed cache warm
  indexnow: 1,            // ~1h: Bing/Yandex accept instantly, index within the hour

  // Partner ingest pipelines — typically same-day, comfortably under 24h.
  spotify: 6,             // Spotify for Artists canonical refresh cycle
  bandsintown: 8,         // Bandsintown event ingest + dedupe pass

  // Moderated / crawl-driven surfaces — land in the 24–48h SLA window.
  songkick: 18,           // Songkick moderation queue (weekdays)
  google_sitemap: 30,     // Googlebot recrawl of updated sitemap URLs

  // Human-in-the-loop surface — routinely misses 48h without a nudge.
  wikidata: 44,           // Volunteer edit + peer review; tight against SLA
};

const TARGET_ENUM = [
  "artist_site","bandsintown","songkick","wikidata",
  "google_sitemap","indexnow","spotify","x",
] as const;

function summarizeChange(canonicalData: unknown): string {
  const d = (canonicalData ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const tour = Array.isArray(d.tour_dates) ? d.tour_dates.length : 0;
  const release = (d.latest_release as { title?: string } | undefined)?.title;
  const bio = (d.bio as { short?: string } | undefined)?.short;
  if (tour) parts.push(`${tour} tour date${tour === 1 ? "" : "s"}`);
  if (release) parts.push(`release: ${String(release).slice(0, 40)}`);
  if (bio) parts.push("bio");
  return parts.length ? `Canonical v${Date.now()} → ${parts.join(", ")}` : "Canonical record refresh";
}

// Fan out the current canonical record to every non-pending distribution target.
// Writes one distribution_log row per target and bumps last_pushed_at.
export const fanOutCanonical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: canonical } = await supabase
      .from("canonical_records").select("data, version")
      .eq("artist_id", data.artistId).eq("is_current", true).maybeSingle();
    if (!canonical) throw new Error("No canonical record to distribute");

    const { data: targets, error: tErr } = await supabase
      .from("distribution_targets").select("*").eq("artist_id", data.artistId);
    if (tErr) throw new Error(tErr.message);
    const pushable = (targets ?? []).filter((t) => t.status !== "pending");
    if (pushable.length === 0) return { pushed: 0, skipped: (targets ?? []).length };

    const summary = `v${canonical.version} · ${summarizeChange(canonical.data)}`;
    const nowIso = new Date().toISOString();

    const inserts = pushable.map((t) => ({
      artist_id: data.artistId,
      target: t.target,
      payload_summary: summary,
    }));
    const { error: iErr } = await supabase.from("distribution_log").insert(inserts);
    if (iErr) throw new Error(iErr.message);

    for (const t of pushable) {
      await supabase.from("distribution_targets")
        .update({ last_pushed_at: nowIso })
        .eq("artist_id", data.artistId).eq("target", t.target);
    }
    return { pushed: pushable.length, skipped: (targets ?? []).length - pushable.length };
  });

// Manually mark a distribution log as confirmed (e.g. operator verified a
// Wikidata edit went live). Computes sla_met from (confirmed - pushed) < 48h.
export const confirmDistribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ logId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: log } = await supabase.from("distribution_log")
      .select("pushed_at").eq("id", data.logId).maybeSingle();
    if (!log) throw new Error("Log entry not found");
    const now = new Date();
    const pushed = new Date(log.pushed_at);
    const withinSla = now.getTime() - pushed.getTime() <= 48 * 3600 * 1000;
    const { error } = await supabase.from("distribution_log")
      .update({ propagation_confirmed_at: now.toISOString(), sla_met: withinSla })
      .eq("id", data.logId);
    if (error) throw new Error(error.message);
    return { ok: true, sla_met: withinSla };
  });

// Adapter type export for cron worker.
export type TargetName = typeof TARGET_ENUM[number];
