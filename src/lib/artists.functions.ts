import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DEFAULT_QUERIES = [
  { text: "When is {artist} playing next?", category: "tour" as const },
  { text: "What venues is {artist} touring in {year}?", category: "tour" as const },
  { text: "What is {artist}'s latest album?", category: "release" as const },
  { text: "Where can I buy tickets to see {artist}?", category: "tickets" as const },
  { text: "Who is {artist}?", category: "bio" as const },
];

const DEFAULT_TARGETS = [
  "artist_site", "bandsintown", "songkick", "wikidata",
  "google_sitemap", "indexnow", "spotify", "x",
] as const;

const DEFAULT_CANONICAL = {
  bio: { short: "", long: "" },
  members: [] as string[],
  hometown: "",
  genres: [] as string[],
  latest_release: { title: "", date: "", links: {} as Record<string, string> },
  tour_dates: [] as Array<{ date: string; venue: string; city: string; country: string; ticket_url: string; status: string }>,
  videos: [] as Array<{ title: string; url: string; date: string }>,
  socials: {} as Record<string, string>,
  press_contact: { name: "", email: "" },
};

export const listArtists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", userId);
    const orgIds = (memberships ?? []).map((m) => m.org_id);
    if (orgIds.length === 0) return [];

    const { data: artists, error } = await supabase
      .from("artists")
      .select("id, name, org_id, status, updated_at, official_site_url")
      .in("org_id", orgIds)
      .order("name");
    if (error) throw new Error(error.message);
    if (!artists) return [];

    // Attach latest audit summary per artist
    const artistIds = artists.map((a) => a.id);
    const { data: runs } = await supabase
      .from("audit_runs")
      .select("artist_id, verdict, agent, run_at")
      .in("artist_id", artistIds)
      .order("run_at", { ascending: false });

    const runsByArtist = new Map<string, Array<{ verdict: string; agent: string; run_at: string }>>();
    for (const r of runs ?? []) {
      if (!runsByArtist.has(r.artist_id)) runsByArtist.set(r.artist_id, []);
      runsByArtist.get(r.artist_id)!.push(r as { verdict: string; agent: string; run_at: string });
    }

    return artists.map((a) => {
      // Take latest run per agent (first occurrence since ordered desc)
      const latestByAgent = new Map<string, { agent: string; verdict: string; run_at: string }>();
      for (const r of runsByArtist.get(a.id) ?? []) {
        if (!latestByAgent.has(r.agent)) latestByAgent.set(r.agent, r);
      }
      const latestRuns = Array.from(latestByAgent.values());
      const lastAuditAt = latestRuns.length > 0
        ? latestRuns.reduce((a, b) => (a.run_at > b.run_at ? a : b)).run_at
        : null;
      const flagged = latestRuns.filter((r) => r.verdict === "wrong" || r.verdict === "stale" || r.verdict === "missing").length;
      return { ...a, latestRuns, lastAuditAt, flagged };
    });
  });

export const getArtistDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: artist, error } = await supabase.from("artists").select("*").eq("id", data.artistId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!artist) throw new Error("Artist not found");

    const { data: canonical } = await supabase
      .from("canonical_records").select("*").eq("artist_id", artist.id).eq("is_current", true).maybeSingle();
    const { data: queries } = await supabase
      .from("audit_queries").select("*").eq("artist_id", artist.id).order("category");
    const { data: runs } = await supabase
      .from("audit_runs").select("*").eq("artist_id", artist.id).order("run_at", { ascending: false }).limit(200);
    const { data: targets } = await supabase
      .from("distribution_targets").select("*").eq("artist_id", artist.id);
    const { data: logs } = await supabase
      .from("distribution_log").select("*").eq("artist_id", artist.id).order("pushed_at", { ascending: false }).limit(50);

    return {
      artist,
      canonical: canonical ?? null,
      queries: queries ?? [],
      runs: runs ?? [],
      targets: targets ?? [],
      logs: logs ?? [],
    };
  });

export const searchSpotifyArtists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { searchArtists } = await import("./spotify.server");
    return searchArtists(data.query);
  });

export const createArtist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      orgId: z.string().uuid(),
      name: z.string().min(1).max(200),
      official_site_url: z.string().url().optional().or(z.literal("")),
      spotify_id: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // Enrich from Spotify if a spotify_id was provided
    let enrichment: Awaited<ReturnType<typeof import("./spotify.server").getArtistEnrichment>> | null = null;
    if (data.spotify_id) {
      try {
        const { getArtistEnrichment } = await import("./spotify.server");
        enrichment = await getArtistEnrichment(data.spotify_id);
      } catch {
        // non-fatal — continue without enrichment
      }
    }

    const resolvedName = enrichment?.name || data.name;

    const { data: artist, error } = await supabase.from("artists").insert({
      org_id: data.orgId,
      name: resolvedName,
      official_site_url: data.official_site_url || null,
      spotify_id: data.spotify_id || null,
      spotify_snapshot: enrichment ? (enrichment as never) : null,
      spotify_synced_at: enrichment ? new Date().toISOString() : null,
    }).select().single();
    if (error) throw new Error(error.message);

    // Seed canonical record v1, populated from Spotify when available
    const seededCanonical = {
      ...DEFAULT_CANONICAL,
      bio: {
        short: enrichment
          ? `${resolvedName} — ${enrichment.genres.slice(0, 3).join(", ") || "artist"} · ${enrichment.followers.toLocaleString()} Spotify followers.`
          : `${resolvedName} — canonical record pending.`,
        long: "",
      },
      genres: enrichment?.genres ?? [],
      latest_release: enrichment?.latest_release
        ? {
            title: enrichment.latest_release.title,
            date: enrichment.latest_release.date,
            links: { spotify: enrichment.latest_release.url },
          }
        : DEFAULT_CANONICAL.latest_release,
      socials: enrichment ? { spotify: enrichment.spotify_url } : {},
    };
    await supabase.from("canonical_records").insert({
      artist_id: artist.id, version: 1, data: seededCanonical, is_current: true, created_by: context.userId,
    });

    // Seed default queries with artist name substitution
    const year = new Date().getFullYear();
    await supabase.from("audit_queries").insert(
      DEFAULT_QUERIES.map((q) => ({
        artist_id: artist.id,
        query_text: q.text.replace("{artist}", resolvedName).replace("{year}", String(year)),
        category: q.category,
      })),
    );

    // Seed default distribution targets (all pending)
    await supabase.from("distribution_targets").insert(
      DEFAULT_TARGETS.map((t) => ({
        artist_id: artist.id,
        target: t,
        status: t === "wikidata" ? "manual" as const : "pending" as const,
      })),
    );

    return artist;
  });

export const saveCanonicalRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    artistId: z.string().uuid(),
    data: z.record(z.unknown()),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    // Find latest version
    const { data: latest } = await supabase
      .from("canonical_records").select("version").eq("artist_id", data.artistId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = (latest?.version ?? 0) + 1;

    // Un-current previous
    await supabase.from("canonical_records").update({ is_current: false })
      .eq("artist_id", data.artistId).eq("is_current", true);

    const { data: inserted, error } = await supabase.from("canonical_records").insert({
      artist_id: data.artistId,
      version: nextVersion,
      data: data.data as never,
      is_current: true,
      created_by: context.userId,
    }).select().single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const refreshArtistFromSpotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: artist, error: aErr } = await supabase
      .from("artists").select("id, name, spotify_id").eq("id", data.artistId).maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!artist) throw new Error("Artist not found");
    if (!artist.spotify_id) throw new Error("No Spotify ID linked to this artist. Add it in Canonical Record → socials or re-create the artist with a Spotify search.");

    const { getArtistEnrichment } = await import("./spotify.server");
    const enrichment = await getArtistEnrichment(artist.spotify_id);

    const { data: current } = await supabase
      .from("canonical_records").select("*").eq("artist_id", artist.id).eq("is_current", true).maybeSingle();
    const base = (current?.data ?? {}) as Record<string, unknown>;
    const baseSocials = (base.socials as Record<string, string> | undefined) ?? {};
    const baseBio = (base.bio as { short?: string; long?: string } | undefined) ?? { short: "", long: "" };

    const merged: Record<string, unknown> = {
      ...base,
      genres: enrichment.genres,
      latest_release: enrichment.latest_release
        ? {
            title: enrichment.latest_release.title,
            date: enrichment.latest_release.date,
            links: {
              ...((base.latest_release as { links?: Record<string, string> } | undefined)?.links ?? {}),
              spotify: enrichment.latest_release.url,
            },
          }
        : base.latest_release,
      socials: { ...baseSocials, spotify: enrichment.spotify_url },
      bio: {
        short: `${enrichment.name} — ${enrichment.genres.slice(0, 3).join(", ") || "artist"} · ${enrichment.followers.toLocaleString()} Spotify followers.`,
        long: baseBio.long ?? "",
      },
    };

    const nextVersion = (current?.version ?? 0) + 1;
    await supabase.from("canonical_records").update({ is_current: false })
      .eq("artist_id", artist.id).eq("is_current", true);
    const { error: insErr } = await supabase.from("canonical_records").insert({
      artist_id: artist.id, version: nextVersion, data: merged as never, is_current: true, created_by: context.userId,
    });
    if (insErr) throw new Error(insErr.message);

    return {
      version: nextVersion,
      name: enrichment.name,
      genres: enrichment.genres,
      followers: enrichment.followers,
      latest_release: enrichment.latest_release,
    };
  });
