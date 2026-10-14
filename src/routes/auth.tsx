import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string; email?: string } => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    email: typeof s.email === "string" ? s.email : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const dest = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/dashboard";
      throw redirect({ to: dest });
    }
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const redirectPath = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup">(search.email ? "signup" : "signin");
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + redirectPath },
        });
        if (error) throw error;
        toast.success("Account created. You're in.");
        navigate({ to: redirectPath });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: redirectPath });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + redirectPath,
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate({ to: redirectPath });
    } catch (err: any) {
      toast.error(err?.message ?? "Google sign-in failed");
      setLoading(false);
    }
  }


  return (
    <div className="grid min-h-screen bg-background text-foreground md:grid-cols-2">
      {/* Left brand column */}
      <div className="hidden flex-col justify-between border-r border-border bg-surface p-12 md:flex">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm bg-primary" />
          <span className="font-display text-lg">VERIFIED</span>
        </div>
        <div>
          <p className="font-display text-4xl leading-[1.05]">
            The AI record<br />of record for<br /><span className="text-primary">your artists.</span>
          </p>
          <p className="mt-6 max-w-sm text-sm text-muted-foreground">
            One canonical source. Five AI assistants monitored daily. Sub-48h propagation to every retrieval surface.
          </p>
        </div>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          &copy; Verified · Broadcast-grade truth for the algorithm era
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {mode === "signin" ? "Sign in" : "Create account"}
            </div>
            <h1 className="mt-2 font-display text-3xl">
              {mode === "signin" ? "Welcome back." : "Let's get you set up."}
            </h1>
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 py-3 text-sm font-semibold hover:bg-surface-elevated disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3-3C17.2 1.7 14.8.7 12 .7 7.4.7 3.5 3.3 1.6 7l3.5 2.7C6 6.9 8.8 5 12 5z"/><path fill="#4285F4" d="M23.3 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.4c-.3 1.5-1.1 2.7-2.4 3.6l3.5 2.7c2.1-1.9 3.8-4.9 3.8-8.4z"/><path fill="#FBBC05" d="M5.1 14.3c-.3-.9-.5-1.8-.5-2.8s.2-1.9.5-2.8L1.6 6C.6 8 0 10 0 12s.6 4 1.6 6l3.5-3.7z"/><path fill="#34A853" d="M12 23.3c3.2 0 6-1.1 8-2.9l-3.5-2.7c-1 .7-2.3 1.1-3.9 1.1-3.2 0-5.9-2-6.9-4.7L1.6 18C3.5 21.7 7.4 23.3 12 23.3z"/></svg>
            Continue with Google
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-background px-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">Or email</span></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@label.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-sm border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "No account? Create one." : "Have an account? Sign in."}
          </button>
        </div>
      </div>
    </div>
  );
}
