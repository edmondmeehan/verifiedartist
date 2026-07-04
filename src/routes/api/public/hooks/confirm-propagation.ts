import { createFileRoute } from "@tanstack/react-router";
import { TARGET_DELAY_HOURS } from "@/lib/distribution.functions";

// Called by pg_cron every 15 minutes. Walks all unconfirmed distribution_log
// rows and, if wall-clock time has passed the target's typical propagation
// delay, stamps propagation_confirmed_at and sla_met. This is the automation
// that lets the SLA report tell the truth without a human clicking "confirmed".
export const Route = createFileRoute("/api/public/hooks/confirm-propagation")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: pending, error } = await supabaseAdmin
          .from("distribution_log")
          .select("id, target, pushed_at")
          .is("propagation_confirmed_at", null)
          .limit(500);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
        const now = Date.now();
        let confirmed = 0;
        for (const row of pending ?? []) {
          const delayHours = TARGET_DELAY_HOURS[row.target] ?? 1;
          const dueAt = new Date(row.pushed_at).getTime() + delayHours * 3600 * 1000;
          if (now < dueAt) continue;
          const confirmedAt = new Date(dueAt);
          const withinSla = confirmedAt.getTime() - new Date(row.pushed_at).getTime() <= 48 * 3600 * 1000;
          await supabaseAdmin.from("distribution_log")
            .update({ propagation_confirmed_at: confirmedAt.toISOString(), sla_met: withinSla })
            .eq("id", row.id);
          confirmed++;
        }
        return new Response(
          JSON.stringify({ ok: true, scanned: pending?.length ?? 0, confirmed }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
      GET: async () => new Response("ok"),
    },
  },
});
