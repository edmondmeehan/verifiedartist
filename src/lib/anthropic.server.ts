// Server-only Anthropic API helper. Do NOT import from client code.

const API_URL = "https://api.anthropic.com/v1/messages";

interface Content {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface AnthropicResponse {
  content: Content[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

interface CallOptions {
  model?: string;
  system?: string;
  maxTokens?: number;
  useWebSearch?: boolean;
}

export async function anthropicCall(prompt: string, opts: CallOptions = {}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: opts.model ?? "claude-sonnet-4-5-20250929",
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: "user", content: prompt }],
  };
  if (opts.system) body.system = opts.system;
  if (opts.useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  const text = json.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
  return text;
}

export async function anthropicJson<T = unknown>(prompt: string, opts: CallOptions = {}): Promise<T> {
  const raw = await anthropicCall(
    prompt + "\n\nRespond with ONLY valid JSON. No prose, no markdown fences.",
    { maxTokens: 800, ...opts },
  );
  // Strip fences if the model adds them anyway.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
