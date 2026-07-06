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

const SITE_URL = "https://verifiedartist.lovable.app";

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

type SyncResult = {
  status: "ok" | "error";
  error?: string;
  details?: Record<string, unknown>;
};

async function checkSpotify(): Promise<SyncResult> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return { status: "error", error: "Platform Spotify credentials are not configured." };
  try {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      const text = await res.text();
      return { status: "error", error: `Spotify token endpoint returned ${res.status}: ${text.slice(0, 200)}` };
    }
    const json: any = await res.json();
    return {
      status: "ok",
      details: { expires_in: json.expires_in, token_type: json.token_type },
    };
  } catch (e: any) {
    return { status: "error", error: e?.message ?? "Failed to reach Spotify" };
  }
}

async function checkIndexNow(): Promise<SyncResult> {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return { status: "error", error: "INDEXNOW_KEY is not configured." };
  try {
    const url = `${SITE_URL}/${key}.txt`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      return {
        status: "error",
        error: `Key file at ${url} returned ${res.status}. Make sure the site is published and the /{key}.txt route serves the IndexNow key.`,
      };
    }
    const text = (await res.text()).trim();
    if (text !== key) {
      return { status: "error", error: `Key file content did not match the configured IndexNow key.` };
    }
    return { status: "ok", details: { keyFileUrl: url } };
  } catch (e: any) {
    return { status: "error", error: e?.message ?? "Failed to reach IndexNow key file" };
  }
}

async function runProviderCheck(provider: string, apiKey: string | null): Promise<SyncResult> {
  if (provider === "spotify") return checkSpotify();
  if (provider === "indexnow") return checkIndexNow();
  if (!apiKey) return { status: "error", error: "No API key stored for this provider." };
  // Non-managed providers: mark as ok if a key exists; live health checks ship with the fan-out engine.
  return { status: "ok", details: { note: "Stored key present. Live health check ships with the fan-out engine." } };
}

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { data: rows, error } = await context.supabase
      .from("org_connections")
      .select("id, provider, api_key, meta, updated_at, last_sync_at, last_sync_status, last_sync_error, last_sync_details")
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);
    const byProvider = new Map<string, any>();
    for (const r of rows ?? []) {
      byProvider.set(r.provider, {
        id: r.id,
        maskedKey: mask(r.api_key),
        meta: r.meta ?? {},
        updatedAt: r.updated_at,
        lastSyncAt: r.last_sync_at,
        lastSyncStatus: r.last_sync_status,
        lastSyncError: r.last_sync_error,
        lastSyncDetails: r.last_sync_details,
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

export const syncConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orgId: z.string().uuid(), provider: providerSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context.supabase, data.orgId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load existing row (if any) to get the org's api_key for non-managed providers.
    const { data: existing } = await supabaseAdmin
      .from("org_connections")
      .select("id, api_key")
      .eq("org_id", data.orgId)
      .eq("provider", data.provider)
      .maybeSingle();

    const result = await runProviderCheck(data.provider, existing?.api_key ?? null);
    const now = new Date().toISOString();

    const patch = {
      last_sync_at: now,
      last_sync_status: result.status,
      last_sync_error: result.error ?? null,
      last_sync_details: result.details ?? null,
    };

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("org_connections")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("org_connections")
        .insert({ org_id: data.orgId, provider: data.provider, created_by: context.userId, ...patch });
      if (error) throw new Error(error.message);
    }

    return { ok: true, ...patch };
  });
