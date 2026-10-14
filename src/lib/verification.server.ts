// Server-only: evidence-based verification of distributed updates.
//
// When a canonical version is distributed we create an update_verifications
// row. Around 24h and 48h later we re-ask the automatic AI assistants the
// artist's questions. The update counts as "verified" only when every
// automatic assistant now answers accurately. Nothing is ever confirmed by a
// timer alone.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runAudit } from "./audit-engine.server";

type DB = SupabaseClient<Database>;

const HOUR = 3600_000;
export const SLA_HOURS = 48;

export async function checkVerification(db: DB, verificationId: string) {
  const { data: v } = await db.from("update_verifications").select("*").eq("id", verificationId).maybeSingle();
  if (!v) throw new Error("Verification not found");
  if (v.status !== "pending") return v;

  const { results, agents } = await runAudit(db, v.artist_id);
  const scored = results.filter((r) => !r.error);
  const notAccurate = scored.filter((r) => r.verdict !== "accurate");
  const now = new Date();
  const passed = scored.length > 0 && notAccurate.length === 0;
  const checksDone = v.checks_done + 1;
  const ageHours = (now.getTime() - new Date(v.created_at).getTime()) / HOUR;

  const lastResult = {
    agents,
    answers: scored.length,
    accurate: scored.length - notAccurate.length,
    errors: results.length - scored.length,
    checked_at: now.toISOString(),
  };

  let status: string = "pending";
  let nextCheck: string = new Date(new Date(v.created_at).getTime() + SLA_HOURS * HOUR).toISOString();
  if (passed) status = "verified";
  else if (ageHours >= SLA_HOURS - 1) status = "missed";
  else if (ageHours >= 24) nextCheck = new Date(new Date(v.created_at).getTime() + SLA_HOURS * HOUR).toISOString();
  else nextCheck = new Date(new Date(v.created_at).getTime() + 24 * HOUR).toISOString();

  const { data: updated } = await db.from("update_verifications").update({
    status,
    checks_done: checksDone,
    last_checked_at: now.toISOString(),
    last_result: lastResult as never,
    next_check_at: nextCheck,
    verified_at: passed ? now.toISOString() : null,
  }).eq("id", v.id).select().single();

  if (status === "verified" || status === "missed") {
    await db.from("distribution_log").update({
      propagation_confirmed_at: passed ? now.toISOString() : null,
      sla_met: passed ? ageHours <= SLA_HOURS : false,
    }).eq("verification_id", v.id);
  }
  return updated ?? v;
}

/** Called by the scheduled job: run every verification whose check is due. */
export async function processDueVerifications(db: DB, limit = 5) {
  const { data: due } = await db
    .from("update_verifications")
    .select("id")
    .eq("status", "pending")
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at")
    .limit(limit);
  const out: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of due ?? []) {
    try {
      const v = await checkVerification(db, row.id);
      out.push({ id: row.id, status: v.status });
    } catch (e) {
      out.push({ id: row.id, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
