// Server-only adapters that ask each AI assistant a fan question the way a fan
// would, with live web search turned on, and return the answer plus every
// link the assistant cited. Do NOT import from client code.
//
// An agent is "automatic" only when its API key is configured. Agents without
// a key stay in manual paste mode — we never invent their answers.

import type { Agent } from "./verdict";

export interface AgentAnswer {
  text: string;
  links: Array<{ url: string; title?: string }>;
}

type Adapter = (question: string) => Promise<AgentAnswer>;

const TIMEOUT_MS = 90_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${new URL(url).hostname} ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- Claude (Anthropic Messages API + web search tool) ---------------------
const claude: Adapter = async (question) => {
  const json = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    {
      model: process.env.ANTHROPIC_AUDIT_MODEL ?? "claude-sonnet-4-5-20250929",
      max_tokens: 1200,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: question }],
    },
  );
  const blocks = (json.content ?? []) as any[];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const links = blocks
    .filter((b) => b.type === "text" && Array.isArray(b.citations))
    .flatMap((b) => b.citations)
    .filter((c: any) => typeof c?.url === "string")
    .map((c: any) => ({ url: c.url as string, title: c.title as string | undefined }));
  return { text, links };
};

// ---- ChatGPT (OpenAI Responses API + web_search tool) ----------------------
const chatgpt: Adapter = async (question) => {
  const json = await postJson(
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: process.env.OPENAI_AUDIT_MODEL ?? "gpt-5-mini",
      tools: [{ type: "web_search" }],
      input: question,
    },
  );
  const parts = ((json.output ?? []) as any[])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c: any) => c.type === "output_text");
  const text = parts.map((p: any) => p.text).join("").trim();
  const links = parts
    .flatMap((p: any) => p.annotations ?? [])
    .filter((a: any) => a.type === "url_citation" && typeof a.url === "string")
    .map((a: any) => ({ url: a.url as string, title: a.title as string | undefined }));
  return { text, links };
};

// ---- Gemini (Generative Language API + Google Search grounding) -----------
const gemini: Adapter = async (question) => {
  const model = process.env.GEMINI_AUDIT_MODEL ?? "gemini-2.5-flash";
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": process.env.GEMINI_API_KEY! },
    {
      contents: [{ role: "user", parts: [{ text: question }] }],
      tools: [{ google_search: {} }],
    },
  );
  const cand = (json.candidates ?? [])[0] ?? {};
  const text = ((cand.content?.parts ?? []) as any[]).map((p) => p.text ?? "").join("").trim();
  const links = ((cand.groundingMetadata?.groundingChunks ?? []) as any[])
    .map((c) => c.web)
    .filter((w: any) => typeof w?.uri === "string")
    .map((w: any) => ({ url: w.uri as string, title: w.title as string | undefined }));
  return { text, links };
};

// ---- Perplexity (Sonar chat completions; search is built in) -------------
const perplexity: Adapter = async (question) => {
  const json = await postJson(
    "https://api.perplexity.ai/chat/completions",
    { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    {
      model: process.env.PERPLEXITY_AUDIT_MODEL ?? "sonar",
      messages: [{ role: "user", content: question }],
    },
  );
  const text = String(json.choices?.[0]?.message?.content ?? "").trim();
  const fromResults = ((json.search_results ?? []) as any[])
    .filter((r) => typeof r?.url === "string")
    .map((r) => ({ url: r.url as string, title: r.title as string | undefined }));
  const fromCitations = ((json.citations ?? []) as any[])
    .filter((u) => typeof u === "string")
    .map((u) => ({ url: u as string }));
  return { text, links: fromResults.length ? fromResults : fromCitations };
};

const ADAPTERS: Partial<Record<Agent, { envKey: string; run: Adapter }>> = {
  claude: { envKey: "ANTHROPIC_API_KEY", run: claude },
  chatgpt: { envKey: "OPENAI_API_KEY", run: chatgpt },
  gemini: { envKey: "GEMINI_API_KEY", run: gemini },
  perplexity: { envKey: "PERPLEXITY_API_KEY", run: perplexity },
  // grok: no adapter yet — stays in manual paste mode.
};

/** Agents whose API key is configured and can be audited automatically. */
export function automaticAgents(): Agent[] {
  return (Object.keys(ADAPTERS) as Agent[]).filter((a) => !!process.env[ADAPTERS[a]!.envKey]);
}

export async function askAgent(agent: Agent, question: string): Promise<AgentAnswer> {
  const adapter = ADAPTERS[agent];
  if (!adapter || !process.env[adapter.envKey]) {
    throw new Error(`${agent} is not configured for automatic audits`);
  }
  return adapter.run(question);
}
