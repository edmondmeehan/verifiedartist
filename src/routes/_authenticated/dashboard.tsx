import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArtists, createArtist, searchSpotifyArtists } from "@/lib/artists.functions";
import { getMyOrg } from "@/lib/org.functions";
import { AGENT_LABELS, scoreFromRuns, scoreTier, type Verdict } from "@/lib/verdict";
import { LastSyncedBadge } from "@/components/LastSyncedBadge";
import { useEffect, useState } from "react";
import { Plus, TrendingDown, TrendingUp, Minus, Loader2, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";


export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const listFn = useServerFn(listArtists);
  const orgFn = useServerFn(getMyOrg);
  const qc = useQueryClient();
  const orgQuery = useQuery({ queryKey: ["my-org"], queryFn: () => orgFn() });
  const artistsQuery = useQuery({ queryKey: ["artists"], queryFn: () => listFn() });

  const [showNew, setShowNew] = useState(false);

  const artists = (artistsQuery.data ?? []).slice().sort((a, b) => {
    const sa = scoreFromRuns((a.latestRuns ?? []) as { verdict: Verdict }[]) ?? -1;
    const sb = scoreFromRuns((b.latestRuns ?? []) as { verdict: Verdict }[]) ?? -1;
    return sa - sb; // worst first
  });

  return (
    <div className="p-8">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Roster</div>
          <h1 className="mt-1 font-display text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI Accuracy Score across every artist in your roster. Sorted by worst first.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add artist
        </button>
      </header>

      {artistsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
        </div>
      ) : artists.length === 0 ? (
        <EmptyState onAdd={() => setShowNew(true)} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
        </div>
      )}

      {showNew && orgQuery.data && (
        <NewArtistDialog
          orgId={orgQuery.data.org.id}
          onClose={() => setShowNew(false)}
          onCreated={() => { qc.invalidateQueries({ queryKey: ["artists"] }); setShowNew(false); }}
        />
      )}
    </div>
  );
}

function ArtistCard({ artist }: { artist: Awaited<ReturnType<typeof listArtists>>[number] }) {
  const runs = artist.latestRuns as { verdict: Verdict }[];
  const score = scoreFromRuns(runs);
  const tier = scoreTier(score);
  const TrendIcon = score === null ? Minus : score >= 85 ? TrendingUp : TrendingDown;

  return (
    <Link
      to="/artists/$artistId"
      params={{ artistId: artist.id }}
      className="group block rounded-sm border border-border bg-surface p-5 transition hover:border-primary/50 hover:bg-surface-elevated"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Artist</div>
          <h3 className="mt-1 font-display text-xl">{artist.name}</h3>
        </div>
        <div className="text-right">
          <div className={`font-display text-4xl leading-none ${tier.color}`}>
            {score === null ? "—" : score}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <TrendIcon className="h-3 w-3" /> {tier.label}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1">
        {(["chatgpt","claude","gemini","perplexity","grok"] as const).map((a) => {
          const r = (artist.latestRuns as { agent: string; verdict: Verdict }[]).find((x) => x.agent === a);
          const v = r?.verdict ?? "missing";
          const c = v === "accurate" ? "bg-verdict-accurate" : v === "stale" ? "bg-verdict-stale" : v === "wrong" ? "bg-verdict-wrong" : "bg-verdict-missing";
          return (
            <div key={a} className="flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5">
              <div className={`h-1.5 w-1.5 rounded-full ${c}`} />
              <span className="font-mono text-[10px] uppercase tracking-wider">{AGENT_LABELS[a]}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{artist.flagged} flagged</span>
        <span>{artist.lastAuditAt ? `Audited ${formatDistanceToNow(new Date(artist.lastAuditAt))} ago` : "Never audited"}</span>
      </div>
    </Link>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-sm border border-dashed border-border bg-surface p-16 text-center">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Empty roster</div>
      <h2 className="mt-2 font-display text-2xl">Add your first artist</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        We'll seed a canonical record, a default set of fan questions, and every distribution target so you can run an audit today.
      </p>
      <button onClick={onAdd} className="mt-6 inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110">
        <Plus className="h-4 w-4" /> Add artist
      </button>
    </div>
  );
}

type SpotifyPick = {
  id: string;
  name: string;
  image: string | null;
  genres: string[];
  followers: number;
  popularity: number;
  spotify_url: string;
};

function NewArtistDialog({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<SpotifyPick | null>(null);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [spotify, setSpotify] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searchFn = useServerFn(searchSpotifyArtists);
  const searchQuery = useQuery({
    queryKey: ["spotify-search", debounced],
    queryFn: () => searchFn({ data: { query: debounced } }),
    enabled: !manual && debounced.length >= 2 && !picked,
    staleTime: 60_000,
  });

  const createFn = useServerFn(createArtist);
  const mutation = useMutation({
    mutationFn: () => {
      const payload = picked
        ? { orgId, name: picked.name, official_site_url: site, spotify_id: picked.id }
        : { orgId, name, official_site_url: site, spotify_id: spotify };
      return createFn({ data: payload });
    },
    onSuccess: () => { toast.success(`${picked?.name || name} added to roster`); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !mutation.isPending && (picked ? true : name.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-sm border border-border bg-surface p-6">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">New artist</div>
        <h2 className="mt-1 font-display text-2xl">Add to roster</h2>

        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }} className="mt-5 space-y-3">
          {!manual && (
            <>
              {picked ? (
                <div className="flex items-center gap-3 rounded-sm border border-border bg-surface-elevated p-3">
                  {picked.image ? (
                    <img src={picked.image} alt="" className="h-12 w-12 rounded-sm object-cover" />
                  ) : (
                    <div className="h-12 w-12 rounded-sm bg-background" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{picked.name}</div>
                    <div className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {picked.genres.slice(0, 2).join(" · ") || "no genres"} · {picked.followers.toLocaleString()} followers
                    </div>
                  </div>
                  <button type="button" onClick={() => { setPicked(null); setQuery(""); }} className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-surface">
                    Change
                  </button>
                </div>
              ) : (
                <Field label="Search Spotify">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Matchbox Twenty"
                      className="input"
                      style={{ paddingLeft: "2rem" }}
                    />
                  </div>
                  {debounced.length >= 2 && (
                    <div className="mt-2 max-h-64 overflow-auto rounded-sm border border-border bg-background">
                      {searchQuery.isFetching ? (
                        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Spotify…
                        </div>
                      ) : (searchQuery.data ?? []).length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">No matches.</div>
                      ) : (
                        (searchQuery.data ?? []).map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => setPicked(r)}
                            className="flex w-full items-center gap-3 border-b border-border p-2 text-left last:border-b-0 hover:bg-surface-elevated"
                          >
                            {r.image ? (
                              <img src={r.image} alt="" className="h-10 w-10 rounded-sm object-cover" />
                            ) : (
                              <div className="h-10 w-10 rounded-sm bg-surface" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{r.name}</div>
                              <div className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                                {r.genres.slice(0, 2).join(" · ") || "—"} · {r.followers.toLocaleString()}
                              </div>
                            </div>
                            <Check className="h-4 w-4 opacity-0" />
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => setManual(true)} className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
                    Can't find them? Enter manually →
                  </button>
                </Field>
              )}
            </>
          )}

          {manual && (
            <>
              <Field label="Name" required>
                <input required autoFocus value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Matchbox Twenty" className="input" />
              </Field>
              <Field label="Spotify artist ID">
                <input value={spotify} onChange={(e) => setSpotify(e.target.value)}
                  placeholder="0PFtn5NtBbbUNbU9EAmIWF" className="input" />
              </Field>
              <button type="button" onClick={() => { setManual(false); setName(""); setSpotify(""); }} className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
                ← Back to Spotify search
              </button>
            </>
          )}

          <Field label="Official site URL">
            <input value={site} onChange={(e) => setSite(e.target.value)} type="url"
              placeholder="https://matchboxtwenty.com" className="input" />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add artist
            </button>
          </div>
        </form>
        <style>{`.input{width:100%;border:1px solid var(--color-border);background:var(--color-input);padding:.5rem .75rem;font-size:.875rem;border-radius:3px;outline:none}.input:focus{border-color:var(--color-primary)}`}</style>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}{required && " *"}</span>
      {children}
    </label>
  );
}
