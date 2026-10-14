export type Verdict = "accurate" | "stale" | "wrong" | "missing" | "pending";

export const VERDICT_META: Record<Verdict, { label: string; className: string; weight: number }> = {
  accurate: { label: "Accurate", className: "verdict-badge text-verdict-accurate border-verdict-accurate/40 bg-verdict-accurate/10", weight: 100 },
  stale:    { label: "Stale",    className: "verdict-badge text-verdict-stale border-verdict-stale/40 bg-verdict-stale/10", weight: 60 },
  wrong:    { label: "Wrong",    className: "verdict-badge text-verdict-wrong border-verdict-wrong/40 bg-verdict-wrong/10", weight: 0 },
  missing:  { label: "Missing",  className: "verdict-badge text-verdict-missing border-verdict-missing/40 bg-verdict-missing/10", weight: 40 },
  pending:  { label: "Pending",  className: "verdict-badge text-verdict-pending border-verdict-pending/40 bg-verdict-pending/10", weight: 50 },
};

// "pending" runs (not yet scored, or the audit itself errored) are not a
// judgement about the assistant, so they don't count toward the score.
export function scoreFromRuns(all: Array<{ verdict: Verdict }>): number | null {
  const runs = all.filter((r) => r.verdict !== "pending");
  if (runs.length === 0) return null;
  const sum = runs.reduce((acc, r) => acc + (VERDICT_META[r.verdict]?.weight ?? 0), 0);
  return Math.round(sum / runs.length);
}

export function scoreTier(score: number | null): { label: string; color: string } {
  if (score === null) return { label: "No data", color: "text-muted-foreground" };
  if (score >= 85) return { label: "Healthy", color: "text-verdict-accurate" };
  if (score >= 60) return { label: "At risk",  color: "text-verdict-stale" };
  return { label: "Critical", color: "text-verdict-wrong" };
}

export const AGENTS = ["chatgpt", "claude", "gemini", "perplexity", "grok"] as const;
export type Agent = typeof AGENTS[number];

export const AGENT_LABELS: Record<Agent, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  grok: "Grok",
};
