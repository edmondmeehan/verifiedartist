import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyOrg } from "@/lib/org.functions";
import { getMyPlatformStatus } from "@/lib/admin.functions";
import { LayoutGrid, History, FileBarChart, Settings, LogOut, Shield, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

function AuthedShell() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const fetchOrg = useServerFn(getMyOrg);
  const orgQuery = useQuery({ queryKey: ["my-org"], queryFn: () => fetchOrg() });
  const platformFn = useServerFn(getMyPlatformStatus);
  const platformQuery = useQuery({ queryKey: ["platform-status"], queryFn: () => platformFn() });

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-sm bg-primary" />
            <span className="font-display text-base">VERIFIED</span>
          </Link>
          {orgQuery.data && (
            <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {orgQuery.data.org.name}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-2">
          <NavItem to="/dashboard" icon={LayoutGrid} label="Dashboard" />
          <NavItem to="/audits" icon={History} label="Audit history" />
          <NavItem to="/sla" icon={FileBarChart} label="SLA report" />
          <NavItem to="/settings" icon={Settings} label="Settings" />
          {(platformQuery.data?.isStaff || platformQuery.data?.needsBootstrap) && (
            <NavItem to="/admin" icon={Shield} label="Admin" />
          )}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 truncate text-xs text-muted-foreground">{user.email}</div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, icon: Icon, label }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-elevated hover:text-foreground [&.active]:bg-surface-elevated [&.active]:text-foreground [&.active]:border-l-2 [&.active]:border-primary"
      activeProps={{ className: "active" }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
