// Server-only audit engine shared by the "Run audit" button and the
// verification cron. Asks every automatic AI assistant each enabled fan
// question, scores the answer against the canonical record, classifies the
// links it gave, and stores one audit_runs row per (question, assistant).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Agent } from "./verdict";
import { askAgent, automaticAgents } from "./agents.server";
import { classifyLink, dedupeLinks, extractUrls, officialDomainsFrom, type ClassifiedLink } from "./links";

type DB = SupabaseClient<Database>;

export interface VerdictJson {
  verdict: "accurate" | "stale" | "wrong" | "missing";
  staleness_days: number | null;
  discrepancies: string[];
}

export async function scoreAgainstCanonical(
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

CANONICAL RECORD (the source of truth the artist's team controls):
${JSON.stringify(canonicalData, null, 2)}

FAN QUESTION:
${question}

AI ASSISTANT'S ANSWER (the answer we are auditing):
${answer}

Compare the AI assistant's answer strictly against the canonical record.
Only judge facts the canonical record actually covers; do not penalise extra detail it doesn't contradict.

Verdict rules:
- "accurate": the answer's factual claims are consistent with the canonical record.
- "stale": the answer references facts that were true earlier but are now outdated per canonical (e.g. old tour, previous album).
- "wrong": the answer contradicts canonical facts (wrong date, wrong venue, wrong lineup).
- "missing": the answer says it does not know, refuses, or gives no substantive answer.

Return this JSON shape only:
{
  "verdict": "accurate" | "stale" | "wrong" | "missing",
  "staleness_days": integer or null,
  "discrepancies": [short strings, each a specific fact that is wrong or stale]
}`;
  try {
    return await anthropicJson<VerdictJson>(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 600 });
  } catch {
    return await anthropicJson<VerdictJson>(prompt, { maxTokens: 600 });
  }
}

export function classifyAnswerLinks(
  text: string,
  cited: Array<{ url: string; title?: string }>,
  officialDomains: string[],
): ClassifiedLink[] {
  const inline = extractUrls(text).map((url) => ({ url, title: undefined as string | undefined }));
  return dedupeLinks([...cited, ...inline].map((l) => classifyLink(l.url, officialDomains, l.title)));
}

export async function officialDomainsForArtist(db: DB, artistId: string, canonical: unknown): Promise<string[]> {
  const { data: artist } = await db.from("artists").select("official_site_url").eq("id", artistId).maybeSingle();
  const siteUrl = process.env.PUBLIC_SITE_URL ?? "https://verifiedartist.lovable.app";
  let hosted = "";
  try { hosted = new URL(siteUrl).hostname; } catch { /* ignore */ }
  return officialDomainsFrom({ officialSiteUrl: artist?.official_site_url, canonical, extra: hosted ? [hosted] : [] });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export interface AuditResult {
  agent: Agent;
  queryId: string;
  verdict: VerdictJson["verdict"];
  error?: string;
}

/**
 * Run every enabled audit question against every automatic assistant.
 * @param categories optionally restrict to question categories (e.g. ["tour","tickets"]).
 */
export async function runAudit(db: DB, artistId: string, opts: { categories?: string[] } = {}): Promise<{
  results: AuditResult[];
  agents: Agent[];
}> {
  const agents = automaticAgents();
  if (agents.length === 0) throw new Error("No AI assistant API keys are configured.");

  const { data: artist } = await db.from("artists").select("id, name").eq("id", artistId).maybeSingle();
  if (!artist) throw new Error("Artist not found");
  const { data: canonical } = await db
    .from("canonical_records").select("data").eq("artist_id", artistId).eq("is_current", true).maybeSingle();
  let q = db.from("audit_queries").select("*").eq("artist_id", artistId).eq("enabled", true);
  if (opts.categories?.length) q = q.in("category", opts.categories as never);
  const { data: queries } = await q;
  if (!queries || queries.length === 0) throw new Error("No audit questions configured");

  const official = await officialDomainsForArtist(db, artistId, canonical?.data);
  const jobs = queries.flatMap((query) => agents.map((agent) => ({ query, agent })));

  const results = await mapLimit(jobs, 6, async ({ query, agent }): Promise<AuditResult> => {
    const question = query.query_text.replaceAll("{artist}", artist.name);
    try {
      const answer = await askAgent(agent, question);
      const links = classifyAnswerLinks(answer.text, answer.links, official);
      const scored = answer.text
        ? await scoreAgainstCanonical(artist.name, question, answer.text, canonical?.data ?? {})
        : { verdict: "missing" as const, staleness_days: null, discrepancies: ["Empty answer"] };
      await db.from("audit_runs").insert({
        artist_id: artistId,
        query_id: query.id,
        agent,
        response_text: answer.text,
        verdict: scored.verdict,
        staleness_days: scored.staleness_days,
        discrepancies: scored.discrepancies,
        links: links as never,
      });
      return { agent, queryId: query.id, verdict: scored.verdict };
    } catch (err) {
      // Record the failure honestly; it is NOT a verdict about the assistant.
      const message = err instanceof Error ? err.message : String(err);
      await db.from("audit_runs").insert({
        artist_id: artistId,
        query_id: query.id,
        agent,
        response_text: `[audit error] ${message}`,
        verdict: "pending",
        staleness_days: null,
        discrepancies: [],
      });
      return { agent, queryId: query.id, verdict: "missing", error: message };
    }
  });

  return { results, agents };
}
