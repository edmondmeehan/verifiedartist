import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Run a full audit now: every enabled question × every assistant whose API
// key is configured (Claude, ChatGPT, Gemini, Perplexity). Assistants without
// a key stay in manual paste mode.
export const runFullAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { runAudit } = await import("./audit-engine.server");
    const { results, agents } = await runAudit(context.supabase, data.artistId);
    const failed = results.filter((r) => r.error);
    return {
      completed: results.length - failed.length,
      total: results.length,
      agents,
      errors: failed.slice(0, 3).map((f) => `${f.agent}: ${f.error}`),
    };
  });

// Which assistants run automatically (API key configured) vs. paste-only.
export const getAgentAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { automaticAgents } = await import("./agents.server");
    return { automatic: automaticAgents() };
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

    const { scoreAgainstCanonical, classifyAnswerLinks, officialDomainsForArtist } = await import("./audit-engine.server");
    const scored = await scoreAgainstCanonical(artist.name, query.query_text, data.answer, canonical?.data ?? {});
    const official = await officialDomainsForArtist(supabase, data.artistId, canonical?.data);
    const links = classifyAnswerLinks(data.answer, [], official);
    const { data: inserted, error } = await supabase.from("audit_runs").insert({
      artist_id: data.artistId,
      query_id: data.queryId,
      agent: data.agent,
      response_text: data.answer,
      verdict: scored.verdict,
      staleness_days: scored.staleness_days,
      discrepancies: scored.discrepancies,
      links: links as never,
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
