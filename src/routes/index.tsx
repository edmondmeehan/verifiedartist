import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Radio, ShieldCheck, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-sm bg-primary" />
            <span className="font-display text-lg">VERIFIED</span>
          </Link>
          <Link
            to="/auth"
            search={{}}
            className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-4xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-verdict-accurate" />
            AI presence platform for music
          </div>
          <h1 className="font-display text-6xl leading-[0.95] md:text-8xl">
            Control what AI<br />
            says about<br />
            <span className="text-primary">your artists.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg text-muted-foreground">
            Fans now ask ChatGPT, Gemini, Claude and Perplexity when you're playing and where to buy tickets. Verified asks them those questions with live search, shows which answers are wrong and which send fans to resale sites, and re-checks the answers after every fix — so you can see it worked.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              to="/auth"
              search={{}}
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
            >
              Start monitoring <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center rounded-sm border border-border px-6 py-3 text-sm font-semibold hover:bg-surface"
            >
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section id="how" className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-px bg-border md:grid-cols-3">
          {[
            { icon: Radio, title: "Audit", body: "We ask each AI assistant the questions your fans ask, score the answers against your official record, and track which ticket links they give." },
            { icon: ShieldCheck, title: "Correct", body: "One official artist record — tour dates, ticket links, releases, bio. Versioned and signed off by your team." },
            { icon: Zap, title: "Verify", body: "Publish to your hosted artist page and IndexNow, get a checklist for Bandsintown, Spotify and Wikidata, then we re-ask the AIs at 24h and 48h to prove the fix landed." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-background p-10">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-6 font-display text-2xl">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-widest">Verified · v0.1</span>
          <span>The artist's AI record of record.</span>
        </div>
      </footer>
    </div>
  );
}
