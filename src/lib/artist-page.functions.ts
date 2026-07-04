import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { anthropicJson } from "@/lib/anthropic.server";
import { z } from "zod";

// ---- Schemas ---------------------------------------------------------------

const startHereCardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(600).optional().default(""),
  url: z.string().trim().url().max(500).optional().or(z.literal("")),
});

const dateRowSchema = z.object({
  date: z.string().trim().min(1).max(60),
  venue: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(200).optional().default(""),
  type: z.string().trim().max(60).optional().default(""),
});

const channelRowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(500),
  description: z.string().trim().max(300).optional().default(""),
});

const faqRowSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(3000),
});

const introStatsSchema = z.object({
  verifiedQuestions: z.number().int().min(0).max(9999).optional(),
  updatedLabel: z.string().trim().max(60).optional(),
});

const liveSnapshotSchema = z.object({
  headline: z.string().trim().max(600).optional().default(""),
  dates: z.array(dateRowSchema).max(200).default([]),
  moreNote: z.string().trim().max(300).optional().default(""),
});

const pageContentSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase, alphanumeric, dashes only"),
  headline: z.string().trim().max(1000).optional().default(""),
  intro_stats: introStatsSchema.default({}),
  start_here: z.array(startHereCardSchema).max(24).default([]),
  live_snapshot: liveSnapshotSchema.default({ dates: [] }),
  official_channels: z.array(channelRowSchema).max(20).default([]),
  faq: z.array(faqRowSchema).max(50).default([]),
});

// ---- Helpers ---------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "artist";
}

async function assertArtistMember(supabase: any, userId: string, artistId: string) {
  const { data: artist, error } = await supabase
    .from("artists")
    .select("id, org_id, name")
    .eq("id", artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!artist) throw new Error("Artist not found");
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", artist.org_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new Error("Not a member of this organization");
  return artist;
}

// ---- Server fns ------------------------------------------------------------

// Load-or-create draft for a member editor
export const getMyArtistPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const artist = await assertArtistMember(supabase, userId, data.artistId);

    const { data: existing } = await supabase
      .from("artist_public_pages")
      .select("*")
      .eq("artist_id", artist.id)
      .maybeSingle();

    if (existing) return { page: existing, artist: { id: artist.id, name: artist.name } };

    // Ensure a unique slug
    let base = slugify(artist.name);
    let slug = base;
    for (let i = 1; i < 20; i++) {
      const { data: taken } = await supabase
        .from("artist_public_pages")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!taken) break;
      slug = `${base}-${i + 1}`;
    }

    const defaultPage = {
      artist_id: artist.id,
      slug,
      published: false,
      headline: "",
      intro_stats: {},
      start_here: [],
      live_snapshot: { headline: "", dates: [], moreNote: "" },
      official_channels: [],
      faq: [],
    };
    const { data: created, error } = await supabase
      .from("artist_public_pages")
      .insert(defaultPage)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { page: created, artist: { id: artist.id, name: artist.name } };
  });

export const saveArtistPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ artistId: z.string().uuid(), content: pageContentSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const artist = await assertArtistMember(supabase, userId, data.artistId);

    // Check slug not taken by another artist
    const { data: slugRow } = await supabase
      .from("artist_public_pages")
      .select("artist_id")
      .eq("slug", data.content.slug)
      .maybeSingle();
    if (slugRow && slugRow.artist_id !== artist.id) {
      throw new Error("That slug is already in use by another artist");
    }

    const patch = {
      slug: data.content.slug,
      headline: data.content.headline,
      intro_stats: data.content.intro_stats,
      start_here: data.content.start_here,
      live_snapshot: data.content.live_snapshot,
      official_channels: data.content.official_channels,
      faq: data.content.faq,
    };
    const { data: updated, error } = await supabase
      .from("artist_public_pages")
      .update(patch)
      .eq("artist_id", artist.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { page: updated };
  });

export const setArtistPagePublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ artistId: z.string().uuid(), published: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const artist = await assertArtistMember(supabase, userId, data.artistId);
    const { data: updated, error } = await supabase
      .from("artist_public_pages")
      .update({ published: data.published })
      .eq("artist_id", artist.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { page: updated };
  });

// Auto-sync snapshot + official channels from the canonical artist record.
// Returns derived values; client merges into local state and can then Save.
export const syncArtistPageFromCanonical = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const artist = await assertArtistMember(supabase, userId, data.artistId);

    const { data: artistRow } = await supabase
      .from("artists")
      .select("name, official_site_url, spotify_id, spotify_snapshot, spotify_synced_at")
      .eq("id", artist.id)
      .maybeSingle();
    const { data: canonicalRow } = await supabase
      .from("canonical_records")
      .select("data")
      .eq("artist_id", artist.id)
      .eq("is_current", true)
      .maybeSingle();
    const canonical = (canonicalRow?.data ?? {}) as any;

    const snap = ((artistRow as any)?.spotify_snapshot ?? {}) as any;
    const latest = (canonical?.latest_release ?? snap?.latest_release ?? null) as any;
    const followers: number | null = canonical?.followers ?? snap?.followers ?? null;

    const bits: string[] = [];
    if (latest?.title && latest?.date) bits.push(`Latest release: “${latest.title}” (${latest.date}).`);
    if (typeof followers === "number") bits.push(`${followers.toLocaleString()} Spotify followers.`);
    const snapshotHeadline = bits.join(" ");

    const socials = (canonical?.socials ?? {}) as Record<string, string>;
    const channels: { name: string; url: string; description: string }[] = [];
    if (artistRow?.official_site_url) {
      channels.push({ name: "Official site", url: artistRow.official_site_url, description: "Official artist website." });
    }
    if (socials.spotify) {
      channels.push({ name: "Spotify", url: socials.spotify, description: "Verified Spotify profile." });
    }
    for (const [key, url] of Object.entries(socials)) {
      if (!url || key === "spotify") continue;
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      channels.push({ name: label, url, description: `Official ${label}.` });
    }
    if (latest?.links?.spotify) {
      channels.push({ name: "Latest release", url: latest.links.spotify, description: `“${latest.title}” on Spotify.` });
    }

    const syncedAt = artistRow?.spotify_synced_at ?? new Date().toISOString();

    return {
      liveSnapshot: {
        headline: snapshotHeadline,
        moreNote: latest?.title ? `Most recent release verified on ${new Date(syncedAt).toLocaleDateString()}.` : "",
      },
      officialChannels: channels,
    };
  });

// AI-populate: use canonical + Spotify snapshot to draft page copy.
export const generateArtistPageWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const artist = await assertArtistMember(supabase, userId, data.artistId);

    const { data: artistRow } = await supabase
      .from("artists")
      .select("name, official_site_url, spotify_id, spotify_snapshot, genres")
      .eq("id", artist.id)
      .maybeSingle();
    const { data: canonicalRow } = await supabase
      .from("canonical_records")
      .select("data")
      .eq("artist_id", artist.id)
      .eq("is_current", true)
      .maybeSingle();

    const facts = {
      name: (artistRow as any)?.name ?? artist.name,
      official_site_url: (artistRow as any)?.official_site_url ?? null,
      genres: (artistRow as any)?.genres ?? [],
      spotify_snapshot: (artistRow as any)?.spotify_snapshot ?? null,
      canonical: (canonicalRow as any)?.data ?? null,
    };

    const system =
      "You draft copy for an artist's official 'source of truth' page shown to fans. " +
      "Use ONLY the facts provided. If a fact isn't in the input, leave that field empty rather than inventing. " +
      "Tone: calm, factual, warm. No hype, no emojis, no hashtags.";

    const prompt = `Draft page copy for the artist below. Return JSON exactly matching this TypeScript type:

{
  "headline": string,                     // 1-2 sentences under the artist name
  "startHere": Array<{ "title": string, "description": string, "url": string }>,  // 3-5 Q&A style cards ("What is current with X", "Is X on tour", etc.)
  "snapshotHeadline": string,             // one sentence summarizing latest release + follower/verified activity
  "moreNote": string,                     // short pointer sentence for below the dates table
  "faq": Array<{ "question": string, "answer": string }>   // 3-6 concise Q&As fans commonly ask
}

Rules:
- Never invent tour dates, venues, or unverified claims.
- Use the official site URL for card links when relevant; otherwise leave "url" as "".
- Keep every field under the limits: headline <= 400 chars, description <= 400, answer <= 800.

Artist facts (JSON):
${JSON.stringify(facts, null, 2)}`;

    type Draft = {
      headline?: string;
      startHere?: { title?: string; description?: string; url?: string }[];
      snapshotHeadline?: string;
      moreNote?: string;
      faq?: { question?: string; answer?: string }[];
    };

    const draft = await anthropicJson<Draft>(prompt, { system, maxTokens: 1600 });

    return {
      headline: (draft.headline ?? "").toString().slice(0, 1000),
      startHere: (draft.startHere ?? [])
        .filter((c) => c && c.title)
        .slice(0, 8)
        .map((c) => ({
          title: String(c.title ?? "").slice(0, 200),
          description: String(c.description ?? "").slice(0, 600),
          url: String(c.url ?? "").slice(0, 500),
        })),
      snapshotHeadline: (draft.snapshotHeadline ?? "").toString().slice(0, 600),
      moreNote: (draft.moreNote ?? "").toString().slice(0, 300),
      faq: (draft.faq ?? [])
        .filter((f) => f && f.question && f.answer)
        .slice(0, 10)
        .map((f) => ({
          question: String(f.question ?? "").slice(0, 300),
          answer: String(f.answer ?? "").slice(0, 3000),
        })),
    };
  });

// ---- Public read (no auth) -------------------------------------------------

export const getPublicArtistPage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { data: page, error } = await supabase
      .from("artist_public_pages")
      .select(
        "slug, headline, intro_stats, start_here, live_snapshot, official_channels, faq, updated_at, artist_id",
      )
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!page) return null;

    // Artist name/image lives on a table without anon read access; use admin
    // for this single narrow projection after confirming the page is published.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: artist } = await supabaseAdmin
      .from("artists")
      .select("name, image_url, official_site_url")
      .eq("id", page.artist_id)
      .maybeSingle();

    return {
      slug: page.slug,
      headline: page.headline ?? "",
      introStats: page.intro_stats ?? {},
      startHere: (page.start_here ?? []) as any[],
      liveSnapshot: (page.live_snapshot ?? {}) as any,
      officialChannels: (page.official_channels ?? []) as any[],
      faq: (page.faq ?? []) as any[],
      updatedAt: page.updated_at,
      artist: {
        name: artist?.name ?? "Artist",
        imageUrl: artist?.image_url ?? null,
        officialSiteUrl: artist?.official_site_url ?? null,
      },
    };
  });
