// Server-only: the weekly email a manager actually reads instead of logging in.
// Every number comes from stored audit runs, verifications and distribution
// logs — nothing is estimated.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { scoreFromRuns, AGENT_LABELS, type Agent, type Verdict } from "./verdict";
import type { ClassifiedLink } from "./links";

type DB = SupabaseClient<Database>;
type Run = Database["public"]["Tables"]["audit_runs"]["Row"];

export interface ArtistWeek {
  artistId: string;
  name: string;
  score: number | null;
  prevScore: number | null;
  wrongAnswers: Array<{ agent: string; question: string; issue: string }>;
  fixesVerified: number;
  fixesMissed: number;
  fixesPending: number;
  openTasks: string[];
  resaleLinks: number;
  buyLinks: number;
  resaleDomains: string[];
  lastAuditAt: string | null;
  headline: string;
}

export interface OrgWeek {
  orgName: string;
  periodStart: string;
  periodEnd: string;
  artists: ArtistWeek[];
}

function latestPerPair(runs: Run[]): Run[] {
  const m = new Map<string, Run>();
  for (const r of runs) {
    const k = `${r.agent}::${r.query_id}`;
    const cur = m.get(k);
    if (!cur || new Date(r.run_at) > new Date(cur.run_at)) m.set(k, r);
  }
  return [...m.values()];
}

const TARGET_NAMES: Record<string, string> = {
  artist_site: "Hosted artist page", bandsintown: "Bandsintown", songkick: "Songkick", wikidata: "Wikidata",
  google_sitemap: "Google Search Console", indexnow: "IndexNow", spotify: "Spotify for Artists", x: "X",
};

export async function buildOrgWeek(db: DB, orgId: string, now = new Date()): Promise<OrgWeek> {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000);
  const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
  const { data: artists } = await db.from("artists").select("id, name").eq("org_id", orgId).eq("status", "active").order("name");

  const out: ArtistWeek[] = [];
  for (const a of artists ?? []) {
    const { data: runs } = await db.from("audit_runs").select("*").eq("artist_id", a.id)
      .order("run_at", { ascending: false }).limit(500);
    const { data: queries } = await db.from("audit_queries").select("id, query_text, category").eq("artist_id", a.id);
    const qText = new Map((queries ?? []).map((q) => [q.id, q]));
    const all = (runs ?? []) as Run[];
    const current = latestPerPair(all);
    const previous = latestPerPair(all.filter((r) => new Date(r.run_at) < since));
    const score = scoreFromRuns(current as { verdict: Verdict }[]);
    const prevScore = scoreFromRuns(previous as { verdict: Verdict }[]);

    const wrongAnswers = current
      .filter((r) => r.verdict === "wrong" || r.verdict === "stale")
      .map((r) => ({
        agent: AGENT_LABELS[r.agent as Agent] ?? r.agent,
        question: qText.get(r.query_id ?? "")?.query_text ?? "",
        issue: (Array.isArray(r.discrepancies) ? (r.discrepancies as string[])[0] : "") || (r.verdict === "stale" ? "Out of date" : "Contradicts your record"),
      }));

    let resaleLinks = 0, buyLinks = 0;
    const resaleDomains = new Set<string>();
    for (const r of current) {
      const cat = qText.get(r.query_id ?? "")?.category;
      if (cat !== "tickets" && cat !== "tour") continue;
      for (const l of ((r.links ?? []) as unknown as ClassifiedLink[])) {
        if (l.kind === "official" || l.kind === "primary" || l.kind === "resale") buyLinks++;
        if (l.kind === "resale") { resaleLinks++; resaleDomains.add(l.domain); }
      }
    }

    // Updates whose outcome landed this week (distributed up to 2 days earlier).
    const { data: vers } = await db.from("update_verifications").select("id, status, created_at, verified_at, last_checked_at")
      .eq("artist_id", a.id).gte("created_at", new Date(since.getTime() - 3 * 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false });
    const inWeek = (iso: string | null) => !!iso && new Date(iso) >= since;
    const fixesVerified = (vers ?? []).filter((v) => v.status === "verified" && inWeek(v.verified_at)).length;
    const fixesMissed = (vers ?? []).filter((v) => v.status === "missed" && inWeek(v.last_checked_at)).length;
    const fixesPending = (vers ?? []).filter((v) => v.status === "pending").length;

    let openTasks: string[] = [];
    const latestV = vers?.[0];
    if (latestV) {
      const { data: tasks } = await db.from("distribution_log").select("target")
        .eq("verification_id", latestV.id).eq("delivery_status", "manual_task");
      openTasks = (tasks ?? []).map((t) => TARGET_NAMES[t.target] ?? t.target);
    }

    const lastAuditAt = all[0]?.run_at ?? null;

    const bits: string[] = [];
    if (fixesVerified) bits.push(`${fixesVerified} fix${fixesVerified === 1 ? "" : "es"} verified in AI answers`);
    if (wrongAnswers.length) bits.push(`${wrongAnswers.length} wrong or outdated answer${wrongAnswers.length === 1 ? "" : "s"}`);
    if (resaleLinks) bits.push(`AI still sending fans to ${[...resaleDomains].slice(0, 2).join(", ")}`);
    if (openTasks.length) bits.push(`${openTasks.length} platform update${openTasks.length === 1 ? "" : "s"} waiting on your team`);
    const headline = bits.length ? bits.join(" · ") : score === null ? "No audits yet" : "All checked answers accurate";

    out.push({
      artistId: a.id, name: a.name, score, prevScore, wrongAnswers, fixesVerified, fixesMissed, fixesPending,
      openTasks, resaleLinks, buyLinks, resaleDomains: [...resaleDomains], lastAuditAt, headline,
    });
  }

  // Worst first: most wrong answers, then lowest score.
  out.sort((x, y) => y.wrongAnswers.length - x.wrongAnswers.length || (x.score ?? 101) - (y.score ?? 101));
  return { orgName: org?.name ?? "Your roster", periodStart: since.toISOString(), periodEnd: now.toISOString(), artists: out };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function weeklySubject(week: OrgWeek): string {
  const wrong = week.artists.reduce((n, a) => n + a.wrongAnswers.length, 0);
  const fixed = week.artists.reduce((n, a) => n + a.fixesVerified, 0);
  const parts: string[] = [];
  if (fixed) parts.push(`${fixed} fixed`);
  parts.push(`${wrong} wrong answer${wrong === 1 ? "" : "s"}`);
  return `Verified weekly · ${week.orgName}: ${parts.join(", ")}`;
}

export function renderWeeklyHtml(week: OrgWeek, appUrl: string): string {
  const rows = week.artists.map((a) => {
    const delta = a.score !== null && a.prevScore !== null ? a.score - a.prevScore : null;
    const deltaStr = delta === null ? "" : delta === 0 ? " (no change)" : ` (${delta > 0 ? "+" : ""}${delta} vs last week)`;
    const wrong = a.wrongAnswers.slice(0, 3).map((w) =>
      `<li style="margin:0 0 4px"><b>${esc(w.agent)}</b> · “${esc(w.question)}” — ${esc(w.issue)}</li>`).join("");
    const resale = a.resaleLinks
      ? `<p style="margin:8px 0 0;color:#b42318">${a.resaleLinks} of ${a.buyLinks} ticket links AI gave point to resale (${esc(a.resaleDomains.join(", "))}).</p>`
      : "";
    const tasks = a.openTasks.length
      ? `<p style="margin:8px 0 0;color:#8a6100">Waiting on your team: ${esc(a.openTasks.join(", "))}.</p>` : "";
    const stale = !a.lastAuditAt || Date.now() - new Date(a.lastAuditAt).getTime() > 8 * 24 * 3600_000
      ? `<p style="margin:8px 0 0;color:#6b6b6b">No audit in the last week — numbers may be out of date.</p>` : "";
    return `
      <tr><td style="padding:20px 0;border-top:1px solid #e7e2d8">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <a href="${appUrl}/artists/${a.artistId}" style="font:700 18px/1.2 -apple-system,Segoe UI,sans-serif;color:#111;text-decoration:none">${esc(a.name)}</a>
        </div>
        <p style="margin:4px 0 0;font-size:14px;color:#111">${esc(a.headline)}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#6b6b6b">AI accuracy: ${a.score ?? "—"}${deltaStr}</p>
        ${wrong ? `<ul style="margin:10px 0 0;padding-left:18px;font-size:13px;color:#333">${wrong}</ul>` : ""}
        ${resale}${tasks}${stale}
      </td></tr>`;
  }).join("");

  return `<!doctype html><html><body style="margin:0;background:#f6f4ef">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e7e2d8;border-radius:6px;padding:28px;font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111">
      <tr><td>
        <div style="font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b">Verified · weekly</div>
        <h1 style="margin:8px 0 4px;font:800 24px/1.2 -apple-system,Segoe UI,sans-serif">What AI told fans about ${esc(week.orgName)}</h1>
        <p style="margin:0;color:#6b6b6b;font-size:13px">${fmt(week.periodStart)} – ${fmt(week.periodEnd)}</p>
      </td></tr>
      ${rows || `<tr><td style="padding:20px 0;color:#6b6b6b">No active artists yet.</td></tr>`}
      <tr><td style="padding-top:20px;border-top:1px solid #e7e2d8">
        <a href="${appUrl}/dashboard" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">Open Verified</a>
        <p style="margin:16px 0 0;font-size:12px;color:#8a8a8a">Answers come from asking each AI assistant your fans' questions with live web search, then checking them against your official record.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function renderWeeklyText(week: OrgWeek, appUrl: string): string {
  const lines = [`Verified weekly — ${week.orgName} (${fmt(week.periodStart)} – ${fmt(week.periodEnd)})`, ""];
  for (const a of week.artists) {
    lines.push(`${a.name}: ${a.headline}`, `  AI accuracy: ${a.score ?? "—"}`);
    for (const w of a.wrongAnswers.slice(0, 3)) lines.push(`  - ${w.agent}: "${w.question}" — ${w.issue}`);
    if (a.resaleLinks) lines.push(`  ${a.resaleLinks} of ${a.buyLinks} ticket links point to resale (${a.resaleDomains.join(", ")})`);
    if (a.openTasks.length) lines.push(`  Waiting on your team: ${a.openTasks.join(", ")}`);
    lines.push("");
  }
  lines.push(`Open Verified: ${appUrl}/dashboard`);
  return lines.join("\n");
}

export async function recipientsForOrg(db: DB, orgId: string): Promise<string[]> {
  const { data: org } = await db.from("organizations").select("weekly_email_recipients").eq("id", orgId).maybeSingle();
  const custom = (org?.weekly_email_recipients ?? []).filter(Boolean);
  if (custom.length) return custom;
  const { data: members } = await db.from("organization_members").select("user_id, role")
    .eq("org_id", orgId).in("role", ["owner", "admin"]);
  const emails: string[] = [];
  for (const m of members ?? []) {
    const { data } = await db.auth.admin.getUserById(m.user_id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

export async function sendEmail(to: string[], subject: string, html: string, text: string): Promise<{ id?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured, so email can't be sent yet.");
  const from = process.env.WEEKLY_EMAIL_FROM ?? "Verified <reports@please.co>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Email provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { id?: string };
}

export function appUrl(): string {
  return (process.env.PUBLIC_SITE_URL ?? "https://verifiedartist.lovable.app").replace(/\/$/, "");
}

/** Send the weekly email for one org (admin client) and stamp last_weekly_email_at. */
export async function sendWeeklyForOrg(db: DB, orgId: string) {
  const to = await recipientsForOrg(db, orgId);
  if (!to.length) {
    await db.from("organizations").update({ last_weekly_email_at: new Date().toISOString() }).eq("id", orgId);
    return { orgId, skipped: "no recipients" };
  }
  const week = await buildOrgWeek(db, orgId);
  const url = appUrl();
  await sendEmail(to, weeklySubject(week), renderWeeklyHtml(week, url), renderWeeklyText(week, url));
  await db.from("organizations").update({ last_weekly_email_at: new Date().toISOString() }).eq("id", orgId);
  return { orgId, sentTo: to.length };
}
