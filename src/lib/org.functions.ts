import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Get (or create) the current user's primary org and its members.
export const getMyOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: memberships, error } = await supabase
      .from("organization_members")
      .select("org_id, role, organizations!inner(id, name, plan, seats, created_at)")
      .eq("user_id", userId)
      .order("created_at", { referencedTable: "organizations", ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    if (!memberships || memberships.length === 0) {
      throw new Error("No organization found. Please sign out and back in.");
    }
    const membership = memberships[0];
    const org = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;

    // Fetch all members of this org
    const { data: allMembers } = await supabase
      .from("organization_members")
      .select("id, user_id, role, created_at")
      .eq("org_id", org.id);

    return { org, role: membership.role, members: allMembers ?? [] };
  });

export const updateOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orgId: z.string().uuid(), name: z.string().min(1).max(120), plan: z.enum(["per_artist", "enterprise"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("organizations")
      .update({ name: data.name, plan: data.plan })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
