import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PROVIDERS = ["bandsintown", "songkick", "wikidata", "spotify", "indexnow", "x"] as const;
const providerSchema = z.enum(PROVIDERS);

// Providers Verified operates centrally via platform-wide secrets.
const SYSTEM_PROVIDERS: Record<string, boolean> = {
  spotify: true, // SPOTIFY_CLIENT_ID / SECRET
  indexnow: true, // INDEXNOW_KEY
};

async function assertOrgAdmin(supabase: any, orgId: string, userId: string) {
  const { data, error } = await supabase.rpc("org_role_of", { _org_id: orgId, _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data || (data !== "owner" && data !== "admin")) throw new Error("Forbidden");
}

function mask(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: rows, error } = await context.supabase
      .from("org_connections")
      .select("id, provider, api_key, meta, updated_at")
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);
    const byProvider = new Map<string, { id: string; maskedKey: string | null; meta: any; updatedAt: string }>();
    for (const r of rows ?? []) {
      byProvider.set(r.provider, {
        id: r.id,
        maskedKey: mask(r.api_key),
        meta: r.meta ?? {},
        updatedAt: r.updated_at,
      });
    }
    return {
      providers: PROVIDERS.map((p) => ({
        provider: p,
        managedByPlatform: !!SYSTEM_PROVIDERS[p],
        connection: byProvider.get(p) ?? null,
      })),
    };
  });

export const upsertConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      orgId: z.string().uuid(),
      provider: providerSchema,
      apiKey: z.string().trim().min(1).max(4096),
      meta: z.record(z.string(), z.string()).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("org_connections")
      .upsert(
        {
          org_id: data.orgId,
          provider: data.provider,
          api_key: data.apiKey,
          meta: data.meta ?? {},
          created_by: context.userId,
        },
        { onConflict: "org_id,provider" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orgId: z.string().uuid(), provider: providerSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { error } = await context.supabase
      .from("org_connections")
      .delete()
      .eq("org_id", data.orgId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
