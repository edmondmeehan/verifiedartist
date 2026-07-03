import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyOrg, updateOrg } from "@/lib/org.functions";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

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

        <section className="rounded-sm border border-border bg-surface p-5">
          <h3 className="font-display text-lg">Team</h3>
          <p className="mt-1 text-xs text-muted-foreground">{q.data.members.length} of {q.data.org.seats} seats used</p>
          <table className="data-table mt-3">
            <thead><tr><th>User ID</th><th>Role</th><th>Joined</th></tr></thead>
            <tbody>
              {q.data.members.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-xs">{m.user_id.slice(0, 8)}…</td>
                  <td className="font-mono text-xs uppercase">{m.role}</td>
                  <td className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Team invites coming in Phase 2. For now, invite new members by having them sign up with your workspace email domain.</p>
        </section>

        <section className="rounded-sm border border-border bg-surface p-5">
          <h3 className="font-display text-lg">API keys</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            {["Bandsintown","Songkick","Wikidata","IndexNow","Spotify","X"].map((s) => (
              <div key={s} className="flex items-center justify-between rounded-sm border border-border bg-background p-3">
                <span className="font-mono uppercase tracking-widest">{s}</span>
                <span className="text-muted-foreground">Not connected</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Connection UI ships in Phase 2 alongside the fan-out engine.</p>
        </section>
      </div>
    </div>
  );
}
