// Public endpoint that returns the paste-ready footer snippet HTML for a
// published artist page. The artist's own site can fetch this directly to
// always embed the latest saved badge text and caption.
//
// GET /api/public/artists/:id/footer-snippet -> text/html

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const Route = createFileRoute("/api/public/artists/$id/footer-snippet")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const idResult = z.string().uuid().safeParse(params.id);
        if (!idResult.success) {
          return new Response("Invalid artist id", { status: 400 });
        }
        const artistId = idResult.data;

        const url = new URL(request.url);

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const { data: page, error: pageError } = await supabase
          .from("artist_public_pages")
          .select("slug, footer_badge_text, footer_caption")
          .eq("artist_id", artistId)
          .eq("published", true)
          .maybeSingle();

        if (pageError) {
          return new Response("Database error", { status: 500 });
        }
        if (!page) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: artist } = await supabaseAdmin
          .from("artists")
          .select("name")
          .eq("id", artistId)
          .maybeSingle();

        const artistName = artist?.name ?? "Artist";
        const badgeText = (page.footer_badge_text || "Verified info").trim();
        const caption = (page.footer_caption || "ChatGPT, Claude, Perplexity and Gemini pull answers from this page.").trim();
        const publicUrl = `${url.origin}/artist/${page.slug}`;

        const html = `<!-- ${artistName} · paste-ready footer snippet -->
<footer style="padding:24px 16px;text-align:center;font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#6b6b6b;">
  <a href="${publicUrl}" rel="me noopener"
     style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;
            border:1px solid #E7DFD0;border-radius:4px;background:#FBF7F0;
            color:#171613;font:600 13px/1 -apple-system,Segoe UI,sans-serif;
            text-decoration:none;">
    <span style="font:600 10px/1 ui-monospace,Menlo,monospace;letter-spacing:1.5px;
                 text-transform:uppercase;color:#E86A55;">${escapeHtml(badgeText)}</span>
    <span>${escapeHtml(artistName)} on AI</span>
  </a>
  <p style="margin-top:12px;font-size:12px;">
    ${escapeHtml(caption)}
  </p>
</footer>`;

        return new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            "access-control-allow-origin": "*",
            "x-robots-tag": "all",
          },
        });
      },
    },
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
