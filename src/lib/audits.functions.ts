import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

interface VerdictJson {
  verdict: "accurate" | "stale" | "wrong" | "missing";
  staleness_days: number | null;
  discrepancies: string[];
}

async function scoreAgainstCanonical(
  artistName: string,
  question: string,
  answer: string,
  canonicalData: unknown,
): Promise<VerdictJson> {
  const { anthropicJson } = await import("./anthropic.server");
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are the fact-checker for an artist AI-presence platform.

ARTIST: ${artistName}
TODAY: ${today}

CANONICAL RECORD (the source of truth we control):
${JSON.stringify(canonicalData, null, 2)}

FAN QUESTION:
${question}

AI ASSISTANT'S ANSWER (the answer we are auditing):
${answer}

Compare the AI assistant's answer strictly against the canonical record.

Verdict rules:
- "accurate": the answer's factual claims are consistent with the canonical record.
- "stale": the answer references facts that were true in a prior version but are now outdated per canonical (e.g. old tour, previous album).
- "wrong": the answer contradicts canonical facts (wrong date, wrong venue, wrong lineup).
- "missing": the answer says it does not know, refuses, or gives no substantive answer.

Return this JSON shape only:
{
  "verdict": "accurate" | "stale" | "wrong" | "missing",
  "staleness_days": integer or null (how many days out of date the answer appears, or null if not applicable),
  "discrepancies": [array of short strings, each a specific fact that is wrong or stale]
}`;
  try {
    return await anthropicJson<VerdictJson>(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 600 });
  } catch {
    // Fall back to sonnet if haiku model id changes
    return await anthropicJson<VerdictJson>(prompt, { maxTokens: 600 });
  }
}

async function askClaudeWithSearch(artistName: string, question: string): Promise<string> {
  const { anthropicCall } = await import("./anthropic.server");
  const filled = question.replaceAll("{artist}", artistName);
  return anthropicCall(
    `A fan asks: "${filled}"\n\nAnswer as a helpful assistant would, using current web search results. Be specific with dates, venues, and titles when relevant. Keep it under 150 words.`,
    { useWebSearch: true, maxTokens: 900 },
  );
}

// Run a full audit: for every enabled query, query Claude-with-web-search
// then score the answer against the canonical record.
export const runFullAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: artist } = await supabase.from("artists").select("*").eq("id", data.artistId).maybeSingle();
    if (!artist) throw new Error("Artist not found");
    const { data: canonical } = await supabase
      .from("canonical_records").select("data").eq("artist_id", artist.id).eq("is_current", true).maybeSingle();
    const { data: queries } = await supabase
      .from("audit_queries").select("*").eq("artist_id", artist.id).eq("enabled", true);
    if (!queries || queries.length === 0) throw new Error("No audit queries configured");

    let completed = 0;
    for (const q of queries) {
      try {
        const answer = await askClaudeWithSearch(artist.name, q.query_text);
        const scored = await scoreAgainstCanonical(artist.name, q.query_text, answer, canonical?.data ?? {});
        await supabase.from("audit_runs").insert({
          artist_id: artist.id,
          query_id: q.id,
          agent: "claude",
          response_text: answer,
          verdict: scored.verdict,
          staleness_days: scored.staleness_days,
          discrepancies: scored.discrepancies,
        });
        completed++;
      } catch (err) {
        await supabase.from("audit_runs").insert({
          artist_id: artist.id,
          query_id: q.id,
          agent: "claude",
          response_text: `[audit error] ${err instanceof Error ? err.message : String(err)}`,
          verdict: "missing",
          staleness_days: null,
          discrepancies: [],
        });
      }
    }
    return { completed, total: queries.length };
  });

// Manual paste mode: user pastes an agent's answer, we score it.
export const scoreManualAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    artistId: z.string().uuid(),
    queryId: z.string().uuid(),
    agent: z.enum(["chatgpt", "claude", "gemini", "perplexity", "grok"]),
    answer: z.string().min(1).max(10000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: artist } = await supabase.from("artists").select("name").eq("id", data.artistId).maybeSingle();
    if (!artist) throw new Error("Artist not found");
    const { data: query } = await supabase.from("audit_queries").select("query_text").eq("id", data.queryId).maybeSingle();
    if (!query) throw new Error("Query not found");
    const { data: canonical } = await supabase
      .from("canonical_records").select("data").eq("artist_id", data.artistId).eq("is_current", true).maybeSingle();

    const scored = await scoreAgainstCanonical(artist.name, query.query_text, data.answer, canonical?.data ?? {});
    const { data: inserted, error } = await supabase.from("audit_runs").insert({
      artist_id: data.artistId,
      query_id: data.queryId,
      agent: data.agent,
      response_text: data.answer,
      verdict: scored.verdict,
      staleness_days: scored.staleness_days,
      discrepancies: scored.discrepancies,
    }).select().single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const addAuditQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    artistId: z.string().uuid(),
    query_text: z.string().min(1).max(400),
    category: z.enum(["tour", "release", "bio", "tickets", "general"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: inserted } = await context.supabase.from("audit_queries").insert({
      artist_id: data.artistId, query_text: data.query_text, category: data.category,
    }).select().single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const logDistribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    artistId: z.string().uuid(),
    target: z.enum(["artist_site","bandsintown","songkick","wikidata","google_sitemap","indexnow","spotify","x"]),
    payload_summary: z.string().max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { error, data: inserted } = await supabase.from("distribution_log").insert({
      artist_id: data.artistId,
      target: data.target,
      payload_summary: data.payload_summary,
    }).select().single();
    if (error) throw new Error(error.message);
    // Bump target's last_pushed_at
    await supabase.from("distribution_targets").update({ last_pushed_at: new Date().toISOString() })
      .eq("artist_id", data.artistId).eq("target", data.target);
    return inserted;
  });
