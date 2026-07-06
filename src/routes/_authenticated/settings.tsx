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
} from "@/lib/connections.functions";
import { useEffect, useState } from "react";
import { Loader2, Save, UserPlus, X, Copy, Trash2, KeyRound, Check } from "lucide-react";
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

  const q = useQuery({
    queryKey: ["org-connections", orgId],
    queryFn: () => listFn({ data: { orgId } }),
    enabled: isAdmin,
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");

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

  if (!isAdmin) {
    return (
      <section className="rounded-sm border border-border bg-surface p-5">
        <h3 className="font-display text-lg">API keys</h3>
        <p className="mt-2 text-xs text-muted-foreground">Only org admins can view or manage connections.</p>
      </section>
    );
  }

  return (
    <section className="rounded-sm border border-border bg-surface p-5">
      <h3 className="font-display text-lg">API keys & connections</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Per-org API keys used by the fan-out and audit engines. Platform-managed providers are already connected for every org.
      </p>

      {q.isLoading ? (
        <div className="mt-4 text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-4 space-y-2">
          {(q.data?.providers ?? []).map((p) => {
            const label = PROVIDER_LABELS[p.provider] ?? p.provider;
            const managed = p.managedByPlatform;
            const connected = !!p.connection;
            const isEditing = editing === p.provider;
            return (
              <div key={p.provider} className="rounded-sm border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
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
                  </div>
                  {!managed && (
                    <div className="flex items-center gap-2">
                      {connected && !isEditing && (
                        <>
                          <span className="font-mono text-xs text-muted-foreground">{p.connection!.maskedKey}</span>
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
                      {!connected && !isEditing && (
                        <button
                          onClick={() => { setEditing(p.provider); setKeyInput(""); }}
                          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-surface-elevated"
                        >
                          <KeyRound className="h-3 w-3" /> Connect
                        </button>
                      )}
                    </div>
                  )}
                </div>
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
        Keys are stored encrypted at rest and only visible to org admins. Live status checks and the fan-out engine ship in Phase 2.
      </p>
    </section>
  );
}
