import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const inviteRole = z.enum(["admin", "editor", "viewer", "member"]);

async function assertOrgAdmin(supabase: any, orgId: string, userId: string) {
  const { data, error } = await supabase.rpc("org_role_of", { _org_id: orgId, _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data || (data !== "owner" && data !== "admin")) {
    throw new Error("Forbidden: org admin access required");
  }
}

export const listOrgInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: invites, error } = await context.supabase
      .from("org_invites")
      .select("id, email, role, token, created_at, expires_at, accepted_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invites: invites ?? [] };
  });

export const createOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      orgId: z.string().uuid(),
      email: z.string().trim().email().max(255),
      role: inviteRole,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);

    // If user with this email already exists, add them directly.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = existing?.users.find((u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase());
    if (match) {
      const { error: memErr } = await supabaseAdmin
        .from("organization_members")
        .insert({ org_id: data.orgId, user_id: match.id, role: data.role })
        .select()
        .single();
      if (memErr && !memErr.message.toLowerCase().includes("duplicate")) throw new Error(memErr.message);
      return { ok: true, addedDirectly: true, email: data.email };
    }

    const { data: inv, error } = await context.supabase
      .from("org_invites")
      .insert({
        org_id: data.orgId,
        email: data.email.toLowerCase(),
        role: data.role,
        invited_by: context.userId,
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, addedDirectly: false, inviteId: inv.id, token: inv.token };
  });

export const revokeOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS enforces admin
    const { error } = await context.supabase.from("org_invites").delete().eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orgId: z.string().uuid(), memberId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: mem, error: memErr } = await context.supabase
      .from("organization_members")
      .select("user_id, role")
      .eq("id", data.memberId)
      .eq("org_id", data.orgId)
      .single();
    if (memErr) throw new Error(memErr.message);
    if (mem.role === "owner") throw new Error("Cannot remove the org owner");
    const { error } = await context.supabase
      .from("organization_members")
      .delete()
      .eq("id", data.memberId)
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orgId: z.string().uuid(), memberId: z.string().uuid(), role: inviteRole }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("organization_members")
      .update({ role: data.role })
      .eq("id", data.memberId)
      .eq("org_id", data.orgId)
      .neq("role", "owner");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Public: view invite (by token) — used by /invite/:token page pre-signin
export const getInviteByToken = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(128) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("org_invites")
      .select("id, email, role, expires_at, accepted_at, org_id, organizations(name)")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return { found: false as const };
    const org = Array.isArray(inv.organizations) ? inv.organizations[0] : inv.organizations;
    return {
      found: true as const,
      email: inv.email,
      role: inv.role,
      expired: new Date(inv.expires_at).getTime() < Date.now(),
      accepted: !!inv.accepted_at,
      orgName: org?.name ?? "an organization",
    };
  });

export const acceptInviteByToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(128) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("org_invites")
      .select("id, org_id, email, role, expires_at, accepted_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invite not found");
    if (inv.accepted_at) throw new Error("Invite already used");
    if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Invite expired");

    // Verify caller email matches invite
    const callerEmail = (context.claims?.email as string | undefined)?.toLowerCase();
    if (!callerEmail || callerEmail !== inv.email.toLowerCase()) {
      throw new Error(`This invite is for ${inv.email}. Sign in with that email to accept.`);
    }

    const { error: memErr } = await supabaseAdmin
      .from("organization_members")
      .insert({ org_id: inv.org_id, user_id: context.userId, role: inv.role });
    if (memErr && !memErr.message.toLowerCase().includes("duplicate")) throw new Error(memErr.message);

    await supabaseAdmin
      .from("org_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: context.userId })
      .eq("id", inv.id);

    return { ok: true, orgId: inv.org_id };
  });
