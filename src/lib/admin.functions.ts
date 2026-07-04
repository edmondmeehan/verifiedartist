import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type PlatformRole = "super_admin" | "staff";

async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: platform staff access required");
}

async function assertSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_platform_role", { _user_id: userId, _role: "super_admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: super admin access required");
}

// Returns the current user's platform role (or null) and whether a bootstrap is needed.
export const getMyPlatformStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: myRoles } = await supabase
      .from("platform_user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (myRoles ?? []).map((r: { role: PlatformRole }) => r.role);

    // Check if any super admin exists (via admin client, since RLS may hide it)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("platform_user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");

    return {
      roles,
      isStaff: roles.length > 0,
      isSuperAdmin: roles.includes("super_admin"),
      needsBootstrap: (count ?? 0) === 0,
    };
  });

// Bootstrap: if no super_admin exists, promote the caller. One-time.
export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("platform_user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if ((count ?? 0) > 0) throw new Error("A super admin already exists");
    const { error } = await supabaseAdmin
      .from("platform_user_roles")
      .insert({ user_id: userId, role: "super_admin" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Paginate through auth users (up to 1000 for now)
    const { data: usersResp, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = usersResp.users;

    const userIds = users.map((u) => u.id);
    const { data: platformRoles } = await supabaseAdmin
      .from("platform_user_roles")
      .select("user_id, role")
      .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data: memberships } = await supabaseAdmin
      .from("organization_members")
      .select("user_id, role, organizations(id, name)")
      .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

    const rolesByUser = new Map<string, PlatformRole[]>();
    for (const r of platformRoles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as PlatformRole);
      rolesByUser.set(r.user_id, arr);
    }
    const orgsByUser = new Map<string, Array<{ orgId: string; orgName: string; role: string }>>();
    for (const m of memberships ?? []) {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      if (!org) continue;
      const arr = orgsByUser.get(m.user_id) ?? [];
      arr.push({ orgId: org.id, orgName: org.name, role: m.role });
      orgsByUser.set(m.user_id, arr);
    }

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        emailConfirmed: !!u.email_confirmed_at,
        banned: !!(u as any).banned_until,
        platformRoles: rolesByUser.get(u.id) ?? [],
        organizations: orgsByUser.get(u.id) ?? [],
      })),
    };
  });

export const setPlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["super_admin", "staff"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("platform_user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

export const removePlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["super_admin", "staff"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    if (data.userId === context.userId && data.role === "super_admin") {
      // Prevent removing your own super admin if you'd be the last
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { count } = await supabaseAdmin
        .from("platform_user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((count ?? 0) <= 1) throw new Error("Cannot remove the last super admin");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("platform_user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("You cannot delete your own account here");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
