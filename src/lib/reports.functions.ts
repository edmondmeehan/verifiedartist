import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Base64 encode a Uint8Array using Node Buffer (available on Cloudflare Workers with nodejs_compat).
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function assertArtistAccess(supabase: any, userId: string, artistId: string) {
  const { data: artist, error } = await supabase
    .from("artists")
    .select("id, org_id, name, status, official_site_url, spotify_id, spotify_synced_at, spotify_snapshot")
    .eq("id", artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!artist) throw new Error("Artist not found");
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", artist.org_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new Error("Not a member of this organization");
  return { artist, memberRole: member.role as string };
}

async function assertOrgAdmin(supabase: any, userId: string, orgId: string) {
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new Error("Not a member of this organization");
  if (!["owner", "admin"].includes(member.role)) throw new Error("Owner or admin role required");
}

async function getOrgName(supabase: any, orgId: string): Promise<string> {
  const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return data?.name ?? "Organization";
}

// ---- Artist report ----------------------------------------------------------
export const generateArtistReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { artist } = await assertArtistAccess(supabase, userId, data.artistId);

    // Canonical
    const { data: canonical } = await supabase
      .from("canonical_records")
      .select("data")
      .eq("artist_id", artist.id)
      .eq("is_current", true)
      .maybeSingle();

    // Latest audit run (group by run_at is not stored; we take the most recent findings snapshot)
    const { data: findings } = await supabase
      .from("audit_runs")
      .select("run_at, verdict, response_text, agent, staleness_days, audit_queries(query_text, category)")
      .eq("artist_id", artist.id)
      .order("run_at", { ascending: false })
      .limit(50);

    let latestAudit: any = null;
    if (findings && findings.length) {
      const latestTime = findings[0].run_at;
      // Take findings from same batch (within 60s)
      const batch = findings.filter((f: any) => Math.abs(new Date(f.run_at).getTime() - new Date(latestTime).getTime()) < 60_000);
      const verdictCounts: Record<string, number> = {};
      for (const f of batch) verdictCounts[f.verdict] = (verdictCounts[f.verdict] ?? 0) + 1;
      latestAudit = {
        runAt: latestTime,
        verdictCounts,
        findings: batch.map((f: any) => ({
          query: Array.isArray(f.audit_queries) ? f.audit_queries[0]?.query_text : f.audit_queries?.query_text,
          agent: f.agent,
          verdict: f.verdict,
          response: f.response_text ?? "",
        })).filter((f: any) => f.query),
      };
    }

    const orgName = await getOrgName(supabase, artist.org_id);
    const { renderArtistReport } = await import("./pdf.server");
    const bytes = await renderArtistReport({
      meta: { orgName, title: `${artist.name} · Artist report`, generatedAt: new Date() },
      artist: {
        name: artist.name,
        status: artist.status,
        officialSiteUrl: artist.official_site_url,
        spotifyId: artist.spotify_id,
        spotifySyncedAt: artist.spotify_synced_at,
        spotifySnapshot: artist.spotify_snapshot,
        canonical: canonical?.data,
      },
      latestAudit,
    });

    return {
      filename: `${artist.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.pdf`,
      mime: "application/pdf",
      base64: toBase64(bytes),
    };
  });

// ---- Audit report -----------------------------------------------------------
export const generateAuditReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ artistId: z.string().uuid(), runAt: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { artist } = await assertArtistAccess(supabase, userId, data.artistId);

    let query = supabase
      .from("audit_runs")
      .select("run_at, verdict, response_text, agent, staleness_days, audit_queries(query_text, category)")
      .eq("artist_id", artist.id)
      .order("run_at", { ascending: false })
      .limit(100);
    const { data: rows } = await query;
    if (!rows || rows.length === 0) throw new Error("No audit runs found for this artist");

    const target = data.runAt ?? rows[0].run_at;
    const batch = rows.filter((r: any) => Math.abs(new Date(r.run_at).getTime() - new Date(target).getTime()) < 60_000);
    const verdictCounts: Record<string, number> = {};
    for (const r of batch) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;

    const orgName = await getOrgName(supabase, artist.org_id);
    const { renderAuditReport } = await import("./pdf.server");
    const bytes = await renderAuditReport({
      meta: { orgName, title: `${artist.name} · Audit`, generatedAt: new Date() },
      run: {
        artistName: artist.name,
        runAt: target,
        verdictCounts,
        findings: batch.map((r: any) => {
          const q = Array.isArray(r.audit_queries) ? r.audit_queries[0] : r.audit_queries;
          return {
            query: q?.query_text ?? "-",
            category: q?.category ?? "-",
            agent: r.agent,
            verdict: r.verdict,
            response: r.response_text ?? "",
            staleness: r.staleness_days,
          };
        }),
      },
    });

    return {
      filename: `${artist.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-audit.pdf`,
      mime: "application/pdf",
      base64: toBase64(bytes),
    };
  });

// ---- Roster summary ---------------------------------------------------------
export const generateRosterReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOrgAdmin(supabase, userId, data.orgId);

    const { data: artists, error } = await supabase
      .from("artists")
      .select("name, status, spotify_synced_at, spotify_snapshot")
      .eq("org_id", data.orgId)
      .order("name");
    if (error) throw new Error(error.message);

    const orgName = await getOrgName(supabase, data.orgId);
    const { renderRosterReport } = await import("./pdf.server");
    const bytes = await renderRosterReport({
      meta: { orgName, title: "Roster summary", generatedAt: new Date() },
      artists: (artists ?? []).map((a: any) => ({
        name: a.name,
        status: a.status,
        followers: a.spotify_snapshot?.followers ?? null,
        popularity: a.spotify_snapshot?.popularity ?? null,
        genres: Array.isArray(a.spotify_snapshot?.genres) ? a.spotify_snapshot.genres : [],
        spotifySyncedAt: a.spotify_synced_at,
      })),
    });

    return {
      filename: `${orgName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-roster.pdf`,
      mime: "application/pdf",
      base64: toBase64(bytes),
    };
  });

// ---- Custom / free-form -----------------------------------------------------
export const generateCustomReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        subtitle: z.string().trim().max(200).optional(),
        sections: z
          .array(
            z.object({
              heading: z.string().trim().max(120).optional(),
              body: z.string().trim().min(1).max(20000),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOrgAdmin(supabase, userId, data.orgId);
    const orgName = await getOrgName(supabase, data.orgId);
    const { renderCustomReport } = await import("./pdf.server");
    const bytes = await renderCustomReport({
      meta: { orgName, title: data.title, subtitle: data.subtitle, generatedAt: new Date() },
      sections: data.sections,
    });
    return {
      filename: `${data.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60)}.pdf`,
      mime: "application/pdf",
      base64: toBase64(bytes),
    };
  });

// Helper for the UI: list artists across orgs the user administers
export const listAdminScope = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("role, org_id, organizations(id, name)")
      .eq("user_id", userId)
      .in("role", ["owner", "admin"]);
    const orgs = (memberships ?? []).map((m: any) => {
      const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return { id: o?.id, name: o?.name, role: m.role };
    }).filter((o: any) => o.id);
    const orgIds = orgs.map((o: any) => o.id);
    const { data: artists } = orgIds.length
      ? await supabase.from("artists").select("id, name, org_id").in("org_id", orgIds).order("name")
      : { data: [] as any[] };
    return { orgs, artists: artists ?? [] };
  });
