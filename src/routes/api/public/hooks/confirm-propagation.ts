import { createFileRoute } from "@tanstack/react-router";

// Scheduled job (pg_cron every ~15 min, or Vercel Cron). Each run:
//  1. Runs any update/announcement verification that is due (6h / 24h / 48h):
//     re-asks the AI assistants and marks it verified only if answers are accurate.
//  2. Weekly refresh: audits one active artist not audited automatically in 6+ days,
//     so the weekly email is based on fresh answers.
//  3. Weekly email: on Mondays from 13:00 UTC (9am ET), sends each org's summary once.
//
// If CRON_SECRET is set, callers must send `Authorization: Bearer <CRON_SECRET>`.
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { processDueVerifications } = await import("@/lib/verification.server");
  const processed = await processDueVerifications(supabaseAdmin, 5);

  // 2. Weekly refresh audit (one artist per run keeps each run short).
  let refreshed: string | null = null;
  try {
    const { automaticAgents } = await import("@/lib/agents.server");
    if (automaticAgents().length) {
      const cutoff = new Date(Date.now() - 6 * 24 * 3600_000).toISOString();
      const { data: stale } = await supabaseAdmin.from("artists").select("id")
        .eq("status", "active")
        .or(`last_auto_audit_at.is.null,last_auto_audit_at.lt.${cutoff}`)
        .order("last_auto_audit_at", { ascending: true, nullsFirst: true })
        .limit(1);
      const artist = stale?.[0];
      if (artist) {
        // Stamp first so a slow or failing audit isn't retried every 15 minutes.
        await supabaseAdmin.from("artists").update({ last_auto_audit_at: new Date().toISOString() }).eq("id", artist.id);
        const { runAudit } = await import("@/lib/audit-engine.server");
        await runAudit(supabaseAdmin, artist.id);
        refreshed = artist.id;
      }
    }
  } catch (e) {
    console.error("weekly refresh failed", e);
  }

  // 3. Weekly email.
  const emails: unknown[] = [];
  const now = new Date();
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 13 && process.env.RESEND_API_KEY) {
    const cutoff = new Date(now.getTime() - 6 * 24 * 3600_000).toISOString();
    const { data: orgs } = await supabaseAdmin.from("organizations").select("id")
      .eq("weekly_email_enabled", true)
      .or(`last_weekly_email_at.is.null,last_weekly_email_at.lt.${cutoff}`)
      .limit(3);
    const { sendWeeklyForOrg } = await import("@/lib/weekly-report.server");
    for (const o of orgs ?? []) {
      try {
        emails.push(await sendWeeklyForOrg(supabaseAdmin, o.id));
      } catch (e) {
        emails.push({ orgId: o.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, refreshed, emails }), {
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
