import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyOrg, updateOrg } from "@/lib/org.functions";
import {
  listOrgInvites,
  createOrgInvite,
  revokeOrgInvite,
  removeOrgMember,
  updateMemberRole,
} from "@/lib/invites.functions";
import {
  listConnections,
  upsertConnection,
  deleteConnection,
  syncConnection,
} from "@/lib/connections.functions";
import { getWeeklyEmailSettings, updateWeeklyEmailSettings, previewWeeklyEmail, sendWeeklyEmailTest } from "@/lib/weekly.functions";
import { useEffect, useState } from "react";
import { Loader2, Save, UserPlus, X, Copy, Trash2, KeyRound, Check, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", desc: "Manage org, members, connections" },
  { value: "editor", label: "Editor", desc: "Edit artists, pages, audits" },
  { value: "viewer", label: "Viewer", desc: "Read-only" },
] as const;

function SettingsPage() {
  const orgFn = useServerFn(getMyOrg);
  const q = useQuery({ queryKey: ["my-org"], queryFn: () => orgFn() });
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [plan, setPlan] = useState<"per_artist" | "enterprise">("per_artist");

  useEffect(() => {
    if (q.data) { setName(q.data.org.name); setPlan(q.data.org.plan); }
  }, [q.data]);

  const updFn = useServerFn(updateOrg);
  const m = useMutation({
    mutationFn: () => updFn({ data: { orgId: q.data!.org.id, name, plan } }),
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["my-org"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading || !q.data) return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…</div>;

  const isAdmin = q.data.role === "owner" || q.data.role === "admin";

  return (
    <div className="p-8">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Organization</div>
      <h1 className="mt-1 font-display text-3xl">Settings</h1>

      <div className="mt-6 grid max-w-3xl gap-6">
        <section className="rounded-sm border border-border bg-surface p-5">
          <h3 className="font-display text-lg">Organization</h3>
          <p className="mt-1 text-xs text-muted-foreground">Your role: <span className="font-mono uppercase text-foreground">{q.data.role}</span></p>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin}
                className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Plan</span>
              <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} disabled={!isAdmin}
                className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                <option value="per_artist">Per artist (1–5 artists)</option>
                <option value="enterprise">Enterprise / label (unlimited)</option>
              </select>
            </label>
            <div className="flex justify-end">
              <button onClick={() => m.mutate()} disabled={!isAdmin || m.isPending} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
            </div>
          </div>
        </section>

        <WeeklyEmailSection orgId={q.data.org.id} isAdmin={isAdmin} />

        <TeamSection orgId={q.data.org.id} seats={q.data.org.seats} members={q.data.members} isAdmin={isAdmin} />

        <ConnectionsSection orgId={q.data.org.id} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function TeamSection({ orgId, seats, members, isAdmin }: {
  orgId: string;
  seats: number;
  members: Array<{ id: string; user_id: string; role: string; created_at: string }>;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOrgInvites);
  const createFn = useServerFn(createOrgInvite);
  const revokeFn = useServerFn(revokeOrgInvite);
  const removeMemFn = useServerFn(removeOrgMember);
  const updateMemFn = useServerFn(updateMemberRole);

  const invitesQ = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => listFn({ data: { orgId } }),
    enabled: isAdmin,
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    qc.invalidateQueries({ queryKey: ["my-org"] });
  };

  const create = useMutation({
    mutationFn: () => createFn({ data: { orgId, email: email.trim(), role } }),
    onSuccess: (res) => {
      setEmail("");
      if (res.addedDirectly) {
        toast.success(`Added ${res.email} to the org`);
        setLastLink(null);
      } else {
        const link = `${window.location.origin}/invite/${res.token}`;
        setLastLink(link);
        toast.success("Invite created");
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeFn({ data: { inviteId } }),
    onSuccess: () => { toast.success("Invite revoked"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMem = useMutation({
    mutationFn: (memberId: string) => removeMemFn({ data: { orgId, memberId } }),
    onSuccess: () => { toast.success("Member removed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: (v: { memberId: string; role: "admin" | "editor" | "viewer" }) =>
      updateMemFn({ data: { orgId, memberId: v.memberId, role: v.role } }),
    onSuccess: () => { toast.success("Role updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = (invitesQ.data?.invites ?? []).filter((i) => !i.accepted_at);

  return (
    <section className="rounded-sm border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg">Team</h3>
        <p className="text-xs text-muted-foreground">{members.length} of {seats} seats used</p>
      </div>

      {isAdmin && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (email) create.mutate(); }}
          className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@label.com"
            className="rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button
            type="submit"
            disabled={create.isPending || !email}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Invite
          </button>
        </form>
      )}

      {lastLink && (
        <div className="mt-3 rounded-sm border border-border bg-surface-elevated p-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Share this invite link</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs">{lastLink}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(lastLink); toast.success("Copied"); }}
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Members</div>
        <table className="data-table">
          <thead><tr><th>User</th><th>Role</th><th>Joined</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {members.map((mm) => (
              <tr key={mm.id}>
                <td className="font-mono text-xs">{mm.user_id.slice(0, 8)}…</td>
                <td>
                  {isAdmin && mm.role !== "owner" ? (
                    <select
                      value={mm.role}
                      onChange={(e) => changeRole.mutate({ memberId: mm.id, role: e.target.value as "admin" | "editor" | "viewer" })}
                      className="rounded-sm border border-border bg-input px-2 py-1 font-mono text-xs uppercase outline-none focus:border-primary"
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      {mm.role === "member" && <option value="member">Member</option>}
                    </select>
                  ) : (
                    <span className="font-mono text-xs uppercase">{mm.role}</span>
                  )}
                </td>
                <td className="text-xs text-muted-foreground">{new Date(mm.created_at).toLocaleDateString()}</td>
                <td className="text-right">
                  {isAdmin && mm.role !== "owner" && (
                    <button
                      title="Remove member"
                      onClick={() => { if (confirm("Remove this member?")) removeMem.mutate(mm.id); }}
                      className="rounded-sm p-1.5 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Pending invites {invitesQ.isLoading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
          </div>
          {pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">No pending invites.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {pending.map((inv) => {
                  const link = `${window.location.origin}/invite/${inv.token}`;
                  return (
                    <tr key={inv.id}>
                      <td className="text-xs">{inv.email}</td>
                      <td className="font-mono text-xs uppercase">{inv.role}</td>
                      <td className="text-xs text-muted-foreground">{new Date(inv.expires_at).toLocaleDateString()}</td>
                      <td className="text-right">
                        <button
                          title="Copy link"
                          onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }}
                          className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Revoke invite"
                          onClick={() => revoke.mutate(inv.id)}
                          className="rounded-sm p-1.5 text-destructive hover:bg-destructive/10"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  bandsintown: "Bandsintown",
  songkick: "Songkick",
  wikidata: "Wikidata",
  spotify: "Spotify",
  indexnow: "IndexNow",
  x: "X (Twitter)",
};

function ConnectionsSection({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listConnections);
  const upsertFn = useServerFn(upsertConnection);
  const deleteFn = useServerFn(deleteConnection);
  const syncFn = useServerFn(syncConnection);

  const q = useQuery({
    queryKey: ["org-connections", orgId],
    queryFn: () => listFn({ data: { orgId } }),
    enabled: isAdmin,
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-connections", orgId] });

  const upsert = useMutation({
    mutationFn: (v: { provider: string; apiKey: string }) =>
      upsertFn({ data: { orgId, provider: v.provider as any, apiKey: v.apiKey } }),
    onSuccess: () => { toast.success("Connection saved"); setEditing(null); setKeyInput(""); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (provider: string) => deleteFn({ data: { orgId, provider: provider as any } }),
    onSuccess: () => { toast.success("Disconnected"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: (provider: string) => syncFn({ data: { orgId, provider: provider as any } }),
    onMutate: (provider) => { setSyncingProvider(provider); },
    onSuccess: (res, provider) => {
      if (res.last_sync_status === "ok") toast.success(`${PROVIDER_LABELS[provider] ?? provider}: healthy`);
      else toast.error(`${PROVIDER_LABELS[provider] ?? provider} check failed`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSyncingProvider(null),
  });

  if (!isAdmin) {
    return (
      <section className="rounded-sm border border-border bg-surface p-5">
        <h3 className="font-display text-lg">API keys</h3>
        <p className="mt-2 text-xs text-muted-foreground">Only org admins can view or manage connections.</p>
      </section>
    );
  }

  const providers = q.data?.providers ?? [];
  const errorCount = providers.filter((p) => p.connection?.lastSyncStatus === "error").length;
  const anySyncing = sync.isPending || syncingProvider !== null;

  const runAll = () => {
    providers.forEach((p) => {
      if (p.managedByPlatform || p.connection) sync.mutate(p.provider);
    });
  };

  return (
    <section className="rounded-sm border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg">API keys & connections</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Live health checks per platform. Platform-managed providers use Verified's shared credentials.
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={anySyncing}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-surface-elevated disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${anySyncing ? "animate-spin" : ""}`} /> Check all
        </button>
      </div>

      {errorCount > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div>
            <div className="font-semibold text-destructive">{errorCount} connection{errorCount > 1 ? "s" : ""} failing</div>
            <div className="mt-0.5 text-muted-foreground">Sync and audit fan-out is paused for the affected platforms until they're restored.</div>
          </div>
        </div>
      )}

      {q.isLoading ? (
        <div className="mt-4 text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-4 space-y-2">
          {providers.map((p) => {
            const label = PROVIDER_LABELS[p.provider] ?? p.provider;
            const managed = p.managedByPlatform;
            const conn = p.connection;
            const connected = !!conn;
            const isEditing = editing === p.provider;
            const isSyncing = syncingProvider === p.provider;
            const syncStatus = conn?.lastSyncStatus;
            const canSync = managed || connected;

            return (
              <div key={p.provider} className="rounded-sm border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs uppercase tracking-widest">{label}</span>
                    {managed ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                        <Check className="h-3 w-3" /> Platform managed
                      </span>
                    ) : connected ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-400">
                        <Check className="h-3 w-3" /> Connected
                      </span>
                    ) : (
                      <span className="rounded-sm bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        Not connected
                      </span>
                    )}
                    {syncStatus === "ok" && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Healthy
                      </span>
                    )}
                    {syncStatus === "error" && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-destructive">
                        <AlertTriangle className="h-3 w-3" /> Failing
                      </span>
                    )}
                    {conn?.lastSyncAt && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        · checked {formatDistanceToNow(new Date(conn.lastSyncAt), { addSuffix: true })}
                      </span>
                    )}
                    {canSync && !conn?.lastSyncAt && (
                      <span className="font-mono text-[10px] text-muted-foreground">· never checked</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {canSync && (
                      <button
                        onClick={() => sync.mutate(p.provider)}
                        disabled={isSyncing}
                        title={syncStatus === "error" ? "Retry health check" : "Run health check"}
                        className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs disabled:opacity-50 ${
                          syncStatus === "error"
                            ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                            : "border-border hover:bg-surface-elevated"
                        }`}
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                        {syncStatus === "error" ? "Retry" : "Sync"}
                      </button>
                    )}
                    {!managed && connected && !isEditing && (
                      <>
                        <span className="font-mono text-xs text-muted-foreground">{conn!.maskedKey}</span>
                        <button
                          onClick={() => { setEditing(p.provider); setKeyInput(""); }}
                          className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-surface-elevated"
                        >
                          Replace
                        </button>
                        <button
                          onClick={() => { if (confirm(`Disconnect ${label}?`)) del.mutate(p.provider); }}
                          className="rounded-sm p-1.5 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {!managed && !connected && !isEditing && (
                      <button
                        onClick={() => { setEditing(p.provider); setKeyInput(""); }}
                        className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-surface-elevated"
                      >
                        <KeyRound className="h-3 w-3" /> Connect
                      </button>
                    )}
                  </div>
                </div>

                {syncStatus === "error" && conn?.lastSyncError && (
                  <div className="mt-2 rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-[11px]">
                    <div className="font-mono uppercase tracking-widest text-destructive">Error</div>
                    <div className="mt-0.5 break-words text-muted-foreground">{conn.lastSyncError}</div>
                  </div>
                )}

                {isEditing && !managed && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (keyInput.trim()) upsert.mutate({ provider: p.provider, apiKey: keyInput.trim() }); }}
                    className="mt-3 flex items-center gap-2"
                  >
                    <input
                      type="password"
                      autoFocus
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder={`Paste ${label} API key`}
                      className="flex-1 rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      disabled={upsert.isPending || !keyInput.trim()}
                      className="inline-flex items-center gap-1 rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                    >
                      {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setKeyInput(""); }}
                      className="rounded-sm border border-border px-3 py-2 text-xs hover:bg-surface-elevated"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Keys are stored encrypted at rest and only visible to org admins. Non-managed providers show a live health check when the fan-out engine ships.
      </p>
    </section>
  );

}

function WeeklyEmailSection({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getWeeklyEmailSettings);
  const saveFn = useServerFn(updateWeeklyEmailSettings);
  const previewFn = useServerFn(previewWeeklyEmail);
  const testFn = useServerFn(sendWeeklyEmailTest);
  const q = useQuery({ queryKey: ["weekly-email", orgId], queryFn: () => getFn({ data: { orgId } }) });
  const [enabled, setEnabled] = useState(true);
  const [recipients, setRecipients] = useState("");
  const [preview, setPreview] = useState<{ subject: string; html: string; recipients: string[]; artistCount: number; wrongCount: number } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (q.data) { setEnabled(q.data.enabled); setRecipients(q.data.recipients.join(", ")); }
  }, [q.data]);

  const wasEnabled = q.data?.enabled ?? false;
  const turningOn = enabled && !wasEnabled;

  const save = useMutation({
    mutationFn: () => saveFn({ data: {
      orgId, enabled,
      recipients: recipients.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean),
    } }),
    onSuccess: () => { toast.success("Weekly email settings saved"); qc.invalidateQueries({ queryKey: ["weekly-email", orgId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const prev = useMutation({
    mutationFn: () => previewFn({ data: { orgId } }),
    onSuccess: (r) => { setPreview(r); setReviewed(true); },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (to?: string) => testFn({ data: { orgId, to: to || undefined } }),
    onSuccess: (r) => toast.success(`Test sent to ${r.sentTo}`),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-sm border border-border bg-surface p-5">
      <h3 className="font-display text-lg">Weekly email</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Every Monday morning: fixes verified, wrong AI answers, resale ticket links and open tasks for each artist.
        {q.data?.lastSentAt && <> Last sent {formatDistanceToNow(new Date(q.data.lastSentAt))} ago.</>}
      </p>
      {q.data && !q.data.emailConfigured && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-verdict-stale/40 bg-verdict-stale/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-verdict-stale" />
          Email sending isn't set up yet (RESEND_API_KEY). You can still preview the email.
        </div>
      )}
      <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        <li className={`rounded-sm border p-2 ${reviewed ? "border-primary/50" : "border-border"}`}>1. Preview this week's report{reviewed && " ✓"}</li>
        <li className="rounded-sm border border-border p-2">2. Send a test to yourself or a colleague</li>
        <li className={`rounded-sm border p-2 ${wasEnabled ? "border-primary/50" : "border-border"}`}>3. Turn on delivery{wasEnabled && " ✓"}</li>
      </ol>
      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!isAdmin} />
          Send the weekly email to recipients
        </label>
        {turningOn && !reviewed && (
          <p className="text-xs text-verdict-stale">Preview this week's report before turning delivery on.</p>
        )}
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recipients (blank = org owners & admins)</span>
          <input value={recipients} onChange={(e) => setRecipients(e.target.value)} disabled={!isAdmin}
            placeholder="manager@example.com, gm@label.com"
            className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => prev.mutate()} disabled={prev.isPending}
            className="inline-flex items-center gap-2 rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated disabled:opacity-50">
            {prev.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Preview this week
          </button>
          <button onClick={() => test.mutate(undefined)} disabled={test.isPending || !q.data?.emailConfigured}
            className="inline-flex items-center gap-2 rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated disabled:opacity-50">
            {test.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send test to me
          </button>
          <button onClick={() => save.mutate()} disabled={!isAdmin || save.isPending || (turningOn && !reviewed)}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-[90vh] w-full max-w-3xl flex-col rounded-sm border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="truncate text-sm"><span className="text-muted-foreground">Subject:</span> {preview.subject}</div>
              <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              {preview.artistCount} artist{preview.artistCount === 1 ? "" : "s"} · {preview.wrongCount} wrong answer{preview.wrongCount === 1 ? "" : "s"} ·
              Would go to: {preview.recipients.length ? preview.recipients.join(", ") : "no one yet"}
            </div>
            <iframe title="Weekly email preview" srcDoc={preview.html} sandbox="" className="flex-1 bg-white" />
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <input value={testTo} onChange={(e) => setTestTo(e.target.value)} type="email"
                placeholder={isAdmin ? "Test address (blank = me)" : "Sends to you"} disabled={!isAdmin}
                className="min-w-0 flex-1 rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
              <button onClick={() => test.mutate(testTo.trim() || undefined)} disabled={test.isPending || !q.data?.emailConfigured}
                className="inline-flex items-center gap-2 rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated disabled:opacity-50">
                {test.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send test
              </button>
              {isAdmin && !wasEnabled && (
                <button onClick={() => { setEnabled(true); setPreview(null); save.mutate(); }} disabled={save.isPending}
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
                  Looks good — turn on delivery
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
