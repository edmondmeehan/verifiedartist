import { createFileRoute } from "@tanstack/react-router";

// Scheduled job (pg_cron or Vercel Cron). Runs any update verification whose
// 24h / 48h check is due: re-asks the AI assistants and marks the update
// verified only if their answers are now accurate. No time-based confirmation.
//
// If CRON_SECRET is set, callers must send `Authorization: Bearer <CRON_SECRET>`
// (Vercel Cron does this automatically). Each run costs AI API calls, so set it.
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { processDueVerifications } = await import("@/lib/verification.server");
  const processed = await processDueVerifications(supabaseAdmin, 5);
  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/confirm-propagation")({
  server: {
    handlers: {
      POST: async ({ request }) => run(request),
      GET: async ({ request }) => run(request),
    },
  },
});
