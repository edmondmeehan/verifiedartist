import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyPlatformStatus,
  bootstrapSuperAdmin,
  listAllUsers,
  setPlatformRole,
  removePlatformRole,
  deleteUser,
  sendPasswordReset,
  createUser,
} from "@/lib/admin.functions";
import { Loader2, ShieldCheck, ShieldOff, Trash2, KeyRound, Shield, UserPlus, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const statusFn = useServerFn(getMyPlatformStatus);
  const statusQ = useQuery({ queryKey: ["platform-status"], queryFn: () => statusFn() });

  if (statusQ.isLoading || !statusQ.data) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const { isStaff, isSuperAdmin, needsBootstrap } = statusQ.data;

  if (!isStaff) {
    return <BootstrapOrDenied needsBootstrap={needsBootstrap} onDone={() => statusQ.refetch()} />;
  }

  return <UserManagement isSuperAdmin={isSuperAdmin} />;
}

function BootstrapOrDenied({ needsBootstrap, onDone }: { needsBootstrap: boolean; onDone: () => void }) {
  const bootstrapFn = useServerFn(bootstrapSuperAdmin);
  const m = useMutation({
    mutationFn: () => bootstrapFn(),
    onSuccess: () => {
      toast.success("You are now the super admin");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (needsBootstrap) {
    return (
      <div className="p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</div>
        <h1 className="mt-1 font-display text-3xl">Bootstrap platform admin</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          No platform staff exist yet. Claim the first super admin seat to unlock user management for your internal team.
        </p>
        <button
          onClick={() => m.mutate()}
          disabled={m.isPending}
          className="mt-6 inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
        >
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
          Claim super admin
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</div>
      <h1 className="mt-1 font-display text-3xl">Restricted</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        This area is for internal Verified staff. Ask a super admin to grant you access.
      </p>
    </div>
  );
}

function UserManagement({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const listFn = useServerFn(listAllUsers);
  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const setRoleFn = useServerFn(setPlatformRole);
  const removeRoleFn = useServerFn(removePlatformRole);
  const deleteFn = useServerFn(deleteUser);
  const resetFn = useServerFn(sendPasswordReset);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: "super_admin" | "staff" }) => setRoleFn({ data: v }),
    onSuccess: () => { toast.success("Role granted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeRole = useMutation({
    mutationFn: (v: { userId: string; role: "super_admin" | "staff" }) => removeRoleFn({ data: v }),
    onSuccess: () => { toast.success("Role revoked"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (userId: string) => deleteFn({ data: { userId } }),
    onSuccess: () => { toast.success("User deleted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: (email: string) => resetFn({ data: { email } }),
    onSuccess: () => toast.success("Password reset link generated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const users = (usersQ.data?.users ?? []).filter((u) =>
    filter ? (u.email ?? "").toLowerCase().includes(filter.toLowerCase()) || u.id.includes(filter) : true,
  );

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Admin</div>
          <h1 className="mt-1 font-display text-3xl">User management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal staff only. {isSuperAdmin ? "You have super admin rights." : "You have staff read access."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by email or id…"
            className="w-64 rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {isSuperAdmin && <CreateUserForm onCreated={invalidate} />}


      {usersQ.isLoading ? (
        <div className="mt-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading users…</div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-sm border border-border bg-surface">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Email</th>
                <th>Organizations</th>
                <th>Platform role</th>
                <th>Last sign-in</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSuper = u.platformRoles.includes("super_admin");
                const isStaff = u.platformRoles.includes("staff");
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="text-sm">{u.email ?? <span className="text-muted-foreground">—</span>}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{u.id.slice(0, 8)}…</div>
                      {!u.emailConfirmed && <div className="mt-0.5 text-[10px] font-mono uppercase text-amber-500">unconfirmed</div>}
                    </td>
                    <td className="text-xs">
                      {u.organizations.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {u.organizations.map((o) => (
                            <div key={o.orgId}>
                              {o.orgName} <span className="font-mono uppercase text-muted-foreground">· {o.role}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {isSuper && <span className="mr-1 rounded-sm bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">super admin</span>}
                      {isStaff && <span className="rounded-sm bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase">staff</span>}
                      {!isSuper && !isStaff && <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {u.lastSignInAt ? formatDistanceToNow(new Date(u.lastSignInAt), { addSuffix: true }) : "never"}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {u.email && (
                          <button
                            title="Generate password reset link"
                            onClick={() => reset.mutate(u.email!)}
                            className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isSuperAdmin && (
                          <>
                            {!isStaff ? (
                              <button
                                title="Grant staff"
                                onClick={() => setRole.mutate({ userId: u.id, role: "staff" })}
                                className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                title="Revoke staff"
                                onClick={() => removeRole.mutate({ userId: u.id, role: "staff" })}
                                className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                              >
                                <ShieldOff className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {!isSuper ? (
                              <button
                                title="Grant super admin"
                                onClick={() => setRole.mutate({ userId: u.id, role: "super_admin" })}
                                className="rounded-sm p-1.5 text-primary hover:bg-primary/10"
                              >
                                <Shield className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                title="Revoke super admin"
                                onClick={() => removeRole.mutate({ userId: u.id, role: "super_admin" })}
                                className="rounded-sm p-1.5 text-primary hover:bg-primary/10"
                              >
                                <ShieldOff className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              title="Delete user"
                              onClick={() => {
                                if (confirm(`Permanently delete ${u.email ?? u.id}? This cannot be undone.`)) del.mutate(u.id);
                              }}
                              className="rounded-sm p-1.5 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No users match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
