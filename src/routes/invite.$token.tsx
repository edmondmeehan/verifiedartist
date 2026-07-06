import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getInviteByToken, acceptInviteByToken } from "@/lib/invites.functions";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getInviteByToken);
  const acceptFn = useServerFn(acceptInviteByToken);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const inviteQ = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getFn({ data: { token } }),
  });

  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { token } }),
    onSuccess: () => {
      toast.success("Joined the organization");
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (inviteQ.isLoading || hasSession === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading invite…
      </div>
    );
  }

  const inv = inviteQ.data;
  const invalid = !inv?.found || inv.accepted || inv.expired;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-sm border border-border bg-surface p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Invitation</div>
        {!inv?.found ? (
          <>
            <h1 className="mt-2 font-display text-2xl">Invite not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">This link is invalid or has been revoked.</p>
          </>
        ) : inv.accepted ? (
          <>
            <h1 className="mt-2 font-display text-2xl">Already accepted</h1>
            <p className="mt-2 text-sm text-muted-foreground">This invite has already been used.</p>
          </>
        ) : inv.expired ? (
          <>
            <h1 className="mt-2 font-display text-2xl">Invite expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">Ask the org admin to send a fresh one.</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-display text-2xl">Join {inv.orgName}</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              You've been invited to <span className="text-foreground">{inv.orgName}</span> as{" "}
              <span className="font-mono uppercase text-foreground">{inv.role}</span>.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Invite for {inv.email}</p>

            {!hasSession ? (
              <Link
                to="/auth"
                search={{ redirect: `/invite/${token}`, email: inv.email }}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
              >
                Sign in or create account to accept
              </Link>
            ) : (
              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => accept.mutate()}
                  disabled={accept.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                >
                  {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Accept invite
                </button>
                <Link
                  to="/dashboard"
                  className="flex items-center justify-center gap-2 rounded-sm border border-border px-4 py-3 text-sm hover:bg-surface-elevated"
                >
                  <X className="h-4 w-4" /> Decline
                </Link>
              </div>
            )}
          </>
        )}
        {invalid && (
          <Link to="/dashboard" className="mt-6 block text-center text-xs text-muted-foreground hover:text-foreground">
            Go to dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
