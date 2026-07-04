// Crawler-accessible "answer object" feed for a published artist page.
// Inspired by New Lore: the same answer object rendered in the format every
// AI system (ChatGPT, Claude, Perplexity, Gemini) and MCP tool prefers.
//
// GET /api/public/artist/:slug          -> JSON answer-object bundle
// GET /api/public/artist/:slug?format=md -> plain markdown transcript

import { createFileRoute } from "@tanstack/react-router";
import { getPublicArtistPage } from "@/lib/artist-page.functions";

export const Route = createFileRoute("/api/public/artist/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const format = url.searchParams.get("format");

        let page: Awaited<ReturnType<typeof getPublicArtistPage>>;
        try {
          page = await getPublicArtistPage({ data: { slug: params.slug } });
        } catch {
          return new Response("Not found", { status: 404 });
        }
        if (!page) return new Response("Not found", { status: 404 });

        const canonicalUrl = `${url.origin}/artist/${page.slug}`;
        const feedUrl = `${url.origin}/api/public/artist/${page.slug}`;

        if (format === "md" || format === "markdown") {
          const md = renderMarkdown(page, canonicalUrl);
          return new Response(md, {
            status: 200,
            headers: {
              "content-type": "text/markdown; charset=utf-8",
              "cache-control": "public, max-age=300",
              "x-robots-tag": "all",
            },
          });
        }

        const body = {
          $schema: "https://newlore.example/answer-object.v1.json",
          canonicalUrl,
          feedUrl,
          updatedAt: page.updatedAt,
          artist: page.artist,
          headline: page.headline,
          answerObjects: [
            ...(page.startHere ?? []).map((c: any) => ({
              type: "start-here",
              question: c.title,
              answer: c.description,
              source: c.url || null,
            })),
            ...(page.faq ?? []).map((f: any) => ({
              type: "faq",
              question: f.question,
              answer: f.answer,
              source: null,
            })),
          ],
          liveSnapshot: page.liveSnapshot,
          officialChannels: page.officialChannels,
        };

        return new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
            "access-control-allow-origin": "*",
            "x-robots-tag": "all",
          },
        });
      },
    },
  },
});

function renderMarkdown(page: any, canonicalUrl: string) {
  const lines: string[] = [];
  lines.push(`# ${page.artist.name}`);
  lines.push("");
  if (page.headline) {
    lines.push(`> ${page.headline}`);
    lines.push("");
  }
  lines.push(`Canonical: ${canonicalUrl}`);
  lines.push(`Updated: ${page.updatedAt}`);
  lines.push("");

  if ((page.startHere ?? []).length) {
    lines.push("## Start here");
    for (const c of page.startHere) {
      lines.push(`### ${c.title}`);
      if (c.description) lines.push(c.description);
      if (c.url) lines.push(`Source: ${c.url}`);
      lines.push("");
    }
  }
  if (page.liveSnapshot?.headline) {
    lines.push("## Verified live snapshot");
    lines.push(page.liveSnapshot.headline);
    lines.push("");
  }
  if ((page.officialChannels ?? []).length) {
    lines.push("## Official channels");
    for (const c of page.officialChannels) {
      lines.push(`- ${c.name}: ${c.url}${c.description ? ` — ${c.description}` : ""}`);
    }
    lines.push("");
  }
  if ((page.faq ?? []).length) {
    lines.push("## FAQ");
    for (const f of page.faq) {
      lines.push(`### ${f.question}`);
      lines.push(f.answer);
      lines.push("");
    }
  }
  return lines.join("\n");
}
