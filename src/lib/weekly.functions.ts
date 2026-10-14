import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOrgAdmin(supabase: any, orgId: string, userId: string) {
  const { data } = await supabase.from("organization_members").select("role")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data || (data.role !== "owner" && data.role !== "admin")) throw new Error("Only org owners and admins can change this.");
}

export const getWeeklyEmailSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: org, error } = await context.supabase.from("organizations")
      .select("weekly_email_enabled, weekly_email_recipients, last_weekly_email_at").eq("id", data.orgId).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      enabled: org?.weekly_email_enabled ?? true,
      recipients: org?.weekly_email_recipients ?? [],
      lastSentAt: org?.last_weekly_email_at ?? null,
      emailConfigured: !!process.env.RESEND_API_KEY,
    };
  });

export const updateWeeklyEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    orgId: z.string().uuid(),
    enabled: z.boolean(),
    recipients: z.array(z.string().trim().email()).max(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase.from("organizations")
      .update({ weekly_email_enabled: data.enabled, weekly_email_recipients: data.recipients }).eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Render this week's email from live data so the team can see it before it goes out.
export const previewWeeklyEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildOrgWeek, renderWeeklyHtml, weeklySubject, appUrl } = await import("./weekly-report.server");
    const week = await buildOrgWeek(context.supabase, data.orgId);
    return { subject: weeklySubject(week), html: renderWeeklyHtml(week, appUrl()) };
  });

// Send this week's email to the signed-in user only.
export const sendWeeklyEmailTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = u?.user?.email;
    if (!email) throw new Error("Your account has no email address.");
    const m = await import("./weekly-report.server");
    const week = await m.buildOrgWeek(context.supabase, data.orgId);
    await m.sendEmail([email], `[Test] ${m.weeklySubject(week)}`, m.renderWeeklyHtml(week, m.appUrl()), m.renderWeeklyText(week, m.appUrl()));
    return { sentTo: email };
  });
