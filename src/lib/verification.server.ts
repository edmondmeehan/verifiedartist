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

  // Announcements are re-checked on the questions they affect; routine
  // updates on the full question set.
  const categories = v.kind === "announcement" ? ["tour", "tickets", "release"] : undefined;
  const { results, agents } = await runAudit(db, v.artist_id, { categories });
  const scored = results.filter((r) => !r.error);
  const notAccurate = scored.filter((r) => r.verdict !== "accurate");
  const now = new Date();
  const passed = scored.length > 0 && notAccurate.length === 0;
  const checksDone = v.checks_done + 1;
  const created = new Date(v.created_at).getTime();
  const ageHours = (now.getTime() - created) / HOUR;

  const lastResult = {
    agents,
    answers: scored.length,
    accurate: scored.length - notAccurate.length,
    errors: results.length - scored.length,
    checked_at: now.toISOString(),
  };

  // Scheduled checkpoints (hours after distribution).
  const checkpoints = v.kind === "announcement" ? [6, 24, SLA_HOURS] : [24, SLA_HOURS];
  let status = "pending";
  let nextCheck = new Date(created + SLA_HOURS * HOUR).toISOString();
  if (passed) status = "verified";
  else if (ageHours >= SLA_HOURS - 1) status = "missed";
  else {
    const next = checkpoints.find((h) => h > ageHours + 0.25) ?? SLA_HOURS;
    nextCheck = new Date(created + next * HOUR).toISOString();
  }

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
