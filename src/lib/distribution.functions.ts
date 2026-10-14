import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Distribution is honest about what actually happens to each target:
//  - artist_site: we write the canonical tour dates into the hosted artist page (real push).
//  - indexnow:    we ping IndexNow with the hosted page URLs (real push, needs INDEXNOW_KEY).
//  - everything else has no public write API we can use, so it becomes a
//    manual task with exact instructions. A person marks it done.
// Whether AI assistants actually picked the change up is decided later by
// re-auditing them (update_verifications), never by a timer.

export const TARGET_LABELS: Record<string, string> = {
  artist_site: "Hosted artist page",
  bandsintown: "Bandsintown",
  songkick: "Songkick",
  wikidata: "Wikidata",
  google_sitemap: "Google Search Console",
  indexnow: "IndexNow (Bing, Yandex…)",
  spotify: "Spotify for Artists",
  x: "X (Twitter)",
};

const MANUAL_INSTRUCTIONS: Record<string, string> = {
  bandsintown: "Update tour dates in Bandsintown for Artists (artist.bandsintown.com). Bandsintown feeds Google and most AI assistants' tour answers.",
  songkick: "Update tour dates in Songkick Tourbox (tourbox.songkick.com).",
  wikidata: "Edit the artist's Wikidata item (members, genres, latest release). Cite the official site as the reference.",
  google_sitemap: "In Google Search Console, request indexing for the hosted artist page and the official site's tour page. (Google retired sitemap pings in 2023.)",
  spotify: "Update bio, Artist Pick and concerts in Spotify for Artists (artists.spotify.com). Spotify has no write API.",
  x: "Post the update from the artist's X account, linking the official ticket page.",
};

function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL ?? "https://verifiedartist.lovable.app").replace(/\/$/, "");
}

function summarizeChange(canonicalData: unknown): string {
  const d = (canonicalData ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const tour = Array.isArray(d.tour_dates) ? d.tour_dates.length : 0;
  const release = (d.latest_release as { title?: string } | undefined)?.title;
  const bio = (d.bio as { short?: string } | undefined)?.short;
  if (tour) parts.push(`${tour} tour date${tour === 1 ? "" : "s"}`);
  if (release) parts.push(`release: ${String(release).slice(0, 40)}`);
  if (bio) parts.push("bio");
  return parts.length ? parts.join(", ") : "record refresh";
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type Delivery = { status: "delivered" | "manual_task" | "failed"; detail: string };

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

    const { data: page } = await supabase
      .from("artist_public_pages").select("slug, published, live_snapshot")
      .eq("artist_id", data.artistId).maybeSingle();

    const results: Record<string, Delivery> = {};

    for (const t of targets ?? []) {
      if (t.target === "artist_site") {
        if (!page) {
          results.artist_site = { status: "manual_task", detail: "No hosted artist page yet. Create and publish it from the Public page screen." };
          continue;
        }
        const today = new Date().toISOString().slice(0, 10);
        const tour = (((canonical.data as any)?.tour_dates ?? []) as any[])
          .filter((d) => d && typeof d.date === "string" && d.date >= today)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .slice(0, 50)
          .map((d) => ({
            date: formatDate(d.date),
            venue: d.venue ?? "",
            city: [d.city, d.country].filter(Boolean).join(", "),
            type: d.status === "on_sale" ? "On sale" : d.status === "announced" ? "Announced" : (d.status ?? ""),
            ticketUrl: d.ticket_url ?? "",
          }));
        const snapshot = { ...((page.live_snapshot ?? {}) as Record<string, unknown>), dates: tour };
        const { error } = await supabase.from("artist_public_pages")
          .update({ live_snapshot: snapshot as never }).eq("artist_id", data.artistId);
        results.artist_site = error
          ? { status: "failed", detail: error.message }
          : page.published
            ? { status: "delivered", detail: `Hosted page updated with ${tour.length} upcoming date${tour.length === 1 ? "" : "s"}.` }
            : { status: "manual_task", detail: "Page updated but not published. Publish it so AI crawlers can read it." };
        continue;
      }

      if (t.target === "indexnow") {
        const key = process.env.INDEXNOW_KEY;
        if (!key) { results.indexnow = { status: "manual_task", detail: "INDEXNOW_KEY is not configured, so search engines were not pinged." }; continue; }
        if (!page?.published) { results.indexnow = { status: "manual_task", detail: "Publish the hosted artist page first; there is nothing to ping yet." }; continue; }
        const base = siteUrl();
        const host = new URL(base).host;
        try {
          const res = await fetch("https://api.indexnow.org/indexnow", {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              host,
              key,
              keyLocation: `${base}/${key}.txt`,
              urlList: [`${base}/artist/${page.slug}`, `${base}/api/public/artist/${page.slug}`],
            }),
          });
          results.indexnow = res.ok
            ? { status: "delivered", detail: `IndexNow accepted the ping (HTTP ${res.status}).` }
            : { status: "failed", detail: `IndexNow rejected the ping (HTTP ${res.status}).` };
        } catch (e) {
          results.indexnow = { status: "failed", detail: e instanceof Error ? e.message : "IndexNow request failed" };
        }
        continue;
      }

      results[t.target] = { status: "manual_task", detail: MANUAL_INSTRUCTIONS[t.target] ?? "Update this platform manually." };
    }

    // What changed since the last distributed version? New dates, a new
    // release or new ticket links make this an "announcement".
    const { data: lastDistributed } = await supabase.from("update_verifications")
      .select("canonical_version").eq("artist_id", data.artistId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const prevVersion = lastDistributed?.canonical_version ?? canonical.version - 1;
    const { data: prevRecord } = prevVersion > 0 && prevVersion !== canonical.version
      ? await supabase.from("canonical_records").select("data")
          .eq("artist_id", data.artistId).eq("version", prevVersion).maybeSingle()
      : { data: null };
    const { diffCanonical, announcementQuestions } = await import("./announcements");
    const diff = prevRecord ? diffCanonical(prevRecord.data, canonical.data) : null;
    const isAnnouncement = !!diff?.isAnnouncement;

    // Any earlier unverified update is superseded by this one.
    await supabase.from("update_verifications").update({ status: "superseded" })
      .eq("artist_id", data.artistId).eq("status", "pending");

    const summary = `v${canonical.version} · ${isAnnouncement ? diff!.summary : summarizeChange(canonical.data)}`;

    let baseline: { agents?: string[]; answers?: number; accurate?: number; checked_at?: string; error?: string } | null = null;
    let questionsAdded = 0;
    if (isAnnouncement) {
      // Ask the questions fans will ask about this announcement.
      const { data: artistRow } = await supabase.from("artists").select("name").eq("id", data.artistId).maybeSingle();
      const { data: existingQs } = await supabase.from("audit_queries").select("query_text").eq("artist_id", data.artistId);
      const have = new Set((existingQs ?? []).map((q) => q.query_text.toLowerCase()));
      const toAdd = announcementQuestions(artistRow?.name ?? "the artist", diff!).filter((q) => !have.has(q.text.toLowerCase()));
      if (toAdd.length) {
        await supabase.from("audit_queries").insert(toAdd.map((q) => ({ artist_id: data.artistId, query_text: q.text, category: q.category })));
        questionsAdded = toAdd.length;
      }
      // "Before" snapshot: what AI says right now, before it has caught up.
      try {
        const { runAudit } = await import("./audit-engine.server");
        const { results, agents } = await runAudit(supabase, data.artistId, { categories: ["tour", "tickets", "release"] });
        const scored = results.filter((r) => !r.error);
        baseline = {
          agents,
          answers: scored.length,
          accurate: scored.filter((r) => r.verdict === "accurate").length,
          checked_at: new Date().toISOString(),
        };
      } catch (e) {
        baseline = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    const { data: verification, error: vErr } = await supabase.from("update_verifications").insert({
      artist_id: data.artistId,
      canonical_version: canonical.version,
      change_summary: summary,
      kind: isAnnouncement ? "announcement" : "update",
      changes: (diff ?? null) as never,
      baseline_result: baseline as never,
      next_check_at: new Date(Date.now() + (isAnnouncement ? 6 : 24) * 3600_000).toISOString(),
    }).select().single();
    if (vErr) throw new Error(vErr.message);

    const nowIso = new Date().toISOString();
    const rows = Object.entries(results).map(([target, r]) => ({
      artist_id: data.artistId,
      target: target as never,
      payload_summary: summary,
      delivery_status: r.status,
      delivery_detail: r.detail,
      verification_id: verification.id,
    }));
    if (rows.length) {
      const { error: iErr } = await supabase.from("distribution_log").insert(rows);
      if (iErr) throw new Error(iErr.message);
    }

    for (const [target, r] of Object.entries(results)) {
      await supabase.from("distribution_targets").update({
        status: r.status === "delivered" ? "connected" : r.status === "failed" ? "error" : "manual",
        ...(r.status === "delivered" ? { last_pushed_at: nowIso } : {}),
      }).eq("artist_id", data.artistId).eq("target", target as never);
    }

    const counts = { delivered: 0, manual_task: 0, failed: 0 };
    for (const r of Object.values(results)) counts[r.status]++;
    return { ...counts, verificationId: verification.id, isAnnouncement, questionsAdded, baseline };
  });

// A person confirms they completed a manual task on that platform.
// This records the human action only; it does NOT claim AI answers changed.
export const markManualTaskDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ logId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: log } = await context.supabase.from("distribution_log")
      .select("id, artist_id, target, delivery_detail").eq("id", data.logId).maybeSingle();
    if (!log) throw new Error("Log entry not found");
    const { error } = await context.supabase.from("distribution_log").update({
      delivery_status: "done_manual",
      delivery_detail: `Marked done by a team member on ${new Date().toISOString().slice(0, 10)}.`,
    }).eq("id", log.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("distribution_targets")
      .update({ last_pushed_at: new Date().toISOString() })
      .eq("artist_id", log.artist_id).eq("target", log.target);
    return { ok: true };
  });

// Re-ask the AI assistants now instead of waiting for the scheduled check.
export const recheckVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ verificationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { checkVerification } = await import("./verification.server");
    const v = await checkVerification(context.supabase, data.verificationId);
    return { status: v.status, last_result: v.last_result };
  });

export const listVerifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid(), limit: z.number().int().min(1).max(200).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("update_verifications")
      .select("*").eq("artist_id", data.artistId).order("created_at", { ascending: false }).limit(data.limit ?? 10);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
