import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getArtistDetail, saveCanonicalRecord, refreshArtistFromSpotify } from "@/lib/artists.functions";
import { runFullAudit, scoreManualAnswer, addAuditQuery, logDistribution } from "@/lib/audits.functions";
import { fanOutCanonical, confirmDistribution } from "@/lib/distribution.functions";
import { VerdictBadge } from "@/components/verdict-badge";
import { AGENT_LABELS, AGENTS, scoreFromRuns, scoreTier, type Agent, type Verdict } from "@/lib/verdict";
import { ArrowLeft, Loader2, Play, Plus, RefreshCw, Save, Trash2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

export const Route = createFileRoute("/_authenticated/artists/$artistId")({
  component: ArtistDetail,
});

type Tab = "report" | "canonical" | "distribution";

function ArtistDetail() {
  const { artistId } = Route.useParams();
  const detailFn = useServerFn(getArtistDetail);
  const query = useQuery({ queryKey: ["artist", artistId], queryFn: () => detailFn({ data: { artistId } }) });
  const [tab, setTab] = useState<Tab>("report");

  if (query.isLoading) return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…</div>;
  if (query.error) return <div className="p-8 text-sm text-verdict-wrong">{(query.error as Error).message}</div>;
  if (!query.data) return null;

  const { artist, canonical, queries, runs, targets, logs } = query.data;

  // Latest run per (query, agent)
  const latestByAgentQuery = new Map<string, typeof runs[number]>();
  for (const r of runs) {
    const key = `${r.agent}::${r.query_id}`;
    if (!latestByAgentQuery.has(key)) latestByAgentQuery.set(key, r);
  }
  const latestPerAgent = new Map<Agent, typeof runs[number][]>();
  AGENTS.forEach((a) => latestPerAgent.set(a, []));
  for (const r of latestByAgentQuery.values()) {
    if (AGENTS.includes(r.agent as Agent)) latestPerAgent.get(r.agent as Agent)!.push(r);
  }
  const flatLatest = Array.from(latestPerAgent.values()).flat();
  const score = scoreFromRuns(flatLatest as { verdict: Verdict }[]);
  const tier = scoreTier(score);

  return (
    <div className="p-8">
      <Link to="/dashboard" className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Roster
      </Link>

      <header className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Artist · {artist.status}</div>
          <h1 className="mt-1 font-display text-4xl">{artist.name}</h1>
          {artist.official_site_url && (
            <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-muted-foreground hover:text-primary">
              {artist.official_site_url}
            </a>
          )}
        </div>
        <div className="text-right">
          <div className={`font-display text-6xl leading-none ${tier.color}`}>{score === null ? "—" : score}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">AI Accuracy · {tier.label}</div>
        </div>
      </header>

      <div className="mt-6 flex gap-1 border-b border-border">
        <TabButton active={tab === "report"} onClick={() => setTab("report")}>AI Report Card</TabButton>
        <TabButton active={tab === "canonical"} onClick={() => setTab("canonical")}>Canonical Record {canonical && <span className="ml-1 font-mono text-[10px] text-muted-foreground">v{canonical.version}</span>}</TabButton>
        <TabButton active={tab === "distribution"} onClick={() => setTab("distribution")}>Distribution</TabButton>
      </div>

      <div className="mt-6">
        {tab === "report" && <ReportCard artistId={artist.id} artistName={artist.name} queries={queries} runs={runs} />}
        {tab === "canonical" && <CanonicalEditor artistId={artist.id} canonical={canonical} />}
        {tab === "distribution" && <DistributionPane artistId={artist.id} targets={targets} logs={logs} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

/* --------------- REPORT CARD --------------- */
function ReportCard({ artistId, artistName, queries, runs }: {
  artistId: string; artistName: string;
  queries: Awaited<ReturnType<typeof getArtistDetail>>["queries"];
  runs: Awaited<ReturnType<typeof getArtistDetail>>["runs"];
}) {
  const qc = useQueryClient();
  const runAuditFn = useServerFn(runFullAudit);
  const auditMutation = useMutation({
    mutationFn: () => runAuditFn({ data: { artistId } }),
    onSuccess: (r) => { toast.success(`Audited ${r.completed} of ${r.total} queries`); qc.invalidateQueries({ queryKey: ["artist", artistId] }); qc.invalidateQueries({ queryKey: ["artists"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [pasteFor, setPasteFor] = useState<{ queryId: string; agent: Agent } | null>(null);
  const [showAddQuery, setShowAddQuery] = useState(false);

  const latest = useMemo(() => {
    const m = new Map<string, typeof runs[number]>();
    for (const r of runs) {
      const k = `${r.agent}::${r.query_id}`;
      if (!m.has(k)) m.set(k, r);
    }
    return m;
  }, [runs]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {queries.length} audit {queries.length === 1 ? "query" : "queries"} × 5 agents. Claude runs live via web search; paste other agents' answers manually.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setShowAddQuery(true)} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-elevated">
            <Plus className="h-3.5 w-3.5" /> Add query
          </button>
          <button onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending} className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
            {auditMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Run Claude audit now
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-1/3">Fan question</th>
              {AGENTS.map((a) => <th key={a} className="text-center">{AGENT_LABELS[a]}</th>)}
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <>
                <tr key={q.id}>
                  <td>
                    <button onClick={() => setExpanded(expanded === q.id ? null : q.id)} className="flex items-start gap-1.5 text-left hover:text-primary">
                      {expanded === q.id ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      <div>
                        <div className="font-medium">{q.query_text}</div>
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{q.category}</div>
                      </div>
                    </button>
                  </td>
                  {AGENTS.map((a) => {
                    const r = latest.get(`${a}::${q.id}`);
                    return (
                      <td key={a} className="text-center align-middle">
                        {r ? (
                          <div className="flex flex-col items-center gap-1">
                            <VerdictBadge verdict={r.verdict as Verdict} />
                            {r.staleness_days != null && <span className="font-mono text-[10px] text-muted-foreground">{r.staleness_days}d stale</span>}
                          </div>
                        ) : (
                          <button onClick={() => setPasteFor({ queryId: q.id, agent: a })} className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary">
                            Paste
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expanded === q.id && (
                  <tr key={q.id + "-exp"}>
                    <td colSpan={6} className="bg-background">
                      <div className="grid gap-3 p-3 md:grid-cols-5">
                        {AGENTS.map((a) => {
                          const r = latest.get(`${a}::${q.id}`);
                          return (
                            <div key={a} className="rounded-sm border border-border bg-surface p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{AGENT_LABELS[a]}</div>
                                <button onClick={() => setPasteFor({ queryId: q.id, agent: a })} className="text-[10px] uppercase text-muted-foreground hover:text-primary">Paste new</button>
                              </div>
                              {r ? (
                                <>
                                  <p className="text-xs leading-relaxed">{r.response_text}</p>
                                  {r.discrepancies && Array.isArray(r.discrepancies) && (r.discrepancies as string[]).length > 0 && (
                                    <div className="mt-3 border-t border-border pt-2">
                                      <div className="font-mono text-[10px] uppercase tracking-widest text-verdict-wrong">Discrepancies</div>
                                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                                        {(r.discrepancies as string[]).map((d, i) => <li key={i}>{d}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="mt-2 font-mono text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.run_at))} ago</div>
                                </>
                              ) : (
                                <div className="text-xs text-muted-foreground">No data yet.</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {pasteFor && (
        <PasteAnswerDialog
          artistId={artistId} artistName={artistName}
          queryId={pasteFor.queryId} agent={pasteFor.agent}
          queryText={queries.find((q) => q.id === pasteFor.queryId)?.query_text ?? ""}
          onClose={() => setPasteFor(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["artist", artistId] }); setPasteFor(null); }}
        />
      )}
      {showAddQuery && (
        <AddQueryDialog artistId={artistId} onClose={() => setShowAddQuery(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["artist", artistId] }); setShowAddQuery(false); }} />
      )}
    </div>
  );
}

function PasteAnswerDialog({ artistId, artistName, queryId, agent, queryText, onClose, onDone }: {
  artistId: string; artistName: string; queryId: string; agent: Agent; queryText: string;
  onClose: () => void; onDone: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const scoreFn = useServerFn(scoreManualAnswer);
  const m = useMutation({
    mutationFn: () => scoreFn({ data: { artistId, queryId, agent, answer } }),
    onSuccess: () => { toast.success(`${AGENT_LABELS[agent]} answer scored`); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog onClose={onClose} title={`Paste ${AGENT_LABELS[agent]}'s answer`}>
      <p className="mb-3 text-sm text-muted-foreground">
        Ask <span className="text-foreground">{AGENT_LABELS[agent]}</span>: <span className="italic">"{queryText.replaceAll("{artist}", artistName)}"</span> and paste its full answer below. We'll compare it to the canonical record.
      </p>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={8}
        placeholder="Paste answer here…"
        className="w-full rounded-sm border border-border bg-input p-3 text-sm outline-none focus:border-primary" />
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending || !answer.trim()} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
          {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Score answer
        </button>
      </div>
    </Dialog>
  );
}

function AddQueryDialog({ artistId, onClose, onDone }: { artistId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState<"tour" | "release" | "bio" | "tickets" | "general">("general");
  const fn = useServerFn(addAuditQuery);
  const m = useMutation({
    mutationFn: () => fn({ data: { artistId, query_text: text, category: cat } }),
    onSuccess: () => { toast.success("Query added"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog onClose={onClose} title="Add audit query">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. When is the artist coming to Chicago?"
        className="w-full rounded-sm border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary" />
      <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}
        className="mt-2 w-full rounded-sm border border-border bg-input px-3 py-2.5 text-sm outline-none focus:border-primary">
        {["general","tour","release","tickets","bio"].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-sm border border-border px-4 py-2 text-sm hover:bg-surface-elevated">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending || !text.trim()} className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">Add</button>
      </div>
    </Dialog>
  );
}

/* --------------- CANONICAL --------------- */
type CanonicalData = {
  bio: { short: string; long: string };
  members: string[];
  hometown: string;
  genres: string[];
  latest_release: { title: string; date: string; links: Record<string, string> };
  tour_dates: Array<{ date: string; venue: string; city: string; country: string; ticket_url: string; status: string }>;
  videos: Array<{ title: string; url: string; date: string }>;
  socials: Record<string, string>;
  press_contact: { name: string; email: string };
};

function CanonicalEditor({ artistId, canonical }: { artistId: string; canonical: Awaited<ReturnType<typeof getArtistDetail>>["canonical"] }) {
  const initial = (canonical?.data ?? {}) as unknown as CanonicalData;
  const [data, setData] = useState<CanonicalData>({
    bio: initial.bio ?? { short: "", long: "" },
    members: initial.members ?? [],
    hometown: initial.hometown ?? "",
    genres: initial.genres ?? [],
    latest_release: initial.latest_release ?? { title: "", date: "", links: {} },
    tour_dates: initial.tour_dates ?? [],
    videos: initial.videos ?? [],
    socials: initial.socials ?? {},
    press_contact: initial.press_contact ?? { name: "", email: "" },
  });
  const [dirty, setDirty] = useState(false);
  const qc = useQueryClient();
  const saveFn = useServerFn(saveCanonicalRecord);
  const fanFn = useServerFn(fanOutCanonical);
  const m = useMutation({
    mutationFn: async () => {
      await saveFn({ data: { artistId, data: data as unknown as Record<string, unknown> } });
      return fanFn({ data: { artistId } });
    },
    onSuccess: (r) => {
      toast.success(`Canonical saved · fanned out to ${r.pushed} target${r.pushed === 1 ? "" : "s"}`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["artist", artistId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  function update<K extends keyof CanonicalData>(k: K, v: CanonicalData[K]) { setData((d) => ({ ...d, [k]: v })); setDirty(true); }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Section title="Bio">
          <TextField label="Short bio (used in AI answers)" value={data.bio.short} onChange={(v) => update("bio", { ...data.bio, short: v })} />
          <TextArea label="Long bio" value={data.bio.long} onChange={(v) => update("bio", { ...data.bio, long: v })} rows={5} />
        </Section>

        <Section title="Latest release">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Title" value={data.latest_release.title} onChange={(v) => update("latest_release", { ...data.latest_release, title: v })} />
            <TextField label="Release date" value={data.latest_release.date} onChange={(v) => update("latest_release", { ...data.latest_release, date: v })} placeholder="2025-04-18" />
          </div>
        </Section>

        <Section title="Tour dates" action={
          <button onClick={() => update("tour_dates", [...data.tour_dates, { date: "", venue: "", city: "", country: "", ticket_url: "", status: "on_sale" }])}
            className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-xs hover:bg-surface-elevated">
            <Plus className="h-3 w-3" /> Add date
          </button>
        }>
          {data.tour_dates.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No tour dates yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Venue</th><th>City</th><th>Country</th><th>Ticket URL</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.tour_dates.map((td, i) => (
                    <tr key={i}>
                      <td><Cell value={td.date} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, date:v} : x))} placeholder="2025-08-12" /></td>
                      <td><Cell value={td.venue} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, venue:v} : x))} /></td>
                      <td><Cell value={td.city} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, city:v} : x))} /></td>
                      <td><Cell value={td.country} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, country:v} : x))} /></td>
                      <td><Cell value={td.ticket_url} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, ticket_url:v} : x))} /></td>
                      <td><Cell value={td.status} onChange={(v) => update("tour_dates", data.tour_dates.map((x, j) => j===i ? {...x, status:v} : x))} /></td>
                      <td><button onClick={() => update("tour_dates", data.tour_dates.filter((_, j) => j!==i))} className="text-muted-foreground hover:text-verdict-wrong"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Members">
          <TextField label="Comma-separated" value={data.members.join(", ")} onChange={(v) => update("members", v.split(",").map((s) => s.trim()).filter(Boolean))} />
        </Section>

        <Section title="Genres · Hometown">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Genres (comma-separated)" value={data.genres.join(", ")} onChange={(v) => update("genres", v.split(",").map((s) => s.trim()).filter(Boolean))} />
            <TextField label="Hometown" value={data.hometown} onChange={(v) => update("hometown", v)} />
          </div>
        </Section>
      </div>

      <aside className="space-y-4">
        <div className="sticky top-6 rounded-sm border border-border bg-surface p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Record status</div>
          <div className={`mt-1 font-display text-2xl ${dirty ? "text-verdict-stale" : "text-verdict-accurate"}`}>
            {dirty ? "Unsaved changes" : `Version ${canonical?.version ?? 1}`}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Saving creates a new immutable version. After save, distribute to every retrieval source.
          </p>
          <button onClick={() => m.mutate()} disabled={!dirty || m.isPending} className="mt-4 flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save new version
          </button>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
    </label>
  );
}
function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows ?? 3}
        className="w-full rounded-sm border border-border bg-input p-3 text-sm outline-none focus:border-primary" />
    </label>
  );
}
function Cell({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    className="w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none focus:border-primary focus:bg-background" />;
}

/* --------------- DISTRIBUTION --------------- */
const TARGET_LABELS: Record<string, string> = {
  artist_site: "Artist Site",
  bandsintown: "Bandsintown",
  songkick: "Songkick",
  wikidata: "Wikidata",
  google_sitemap: "Google Sitemap",
  indexnow: "IndexNow",
  spotify: "Spotify",
  x: "X (Twitter)",
};

function DistributionPane({ artistId, targets, logs }: { artistId: string; targets: Awaited<ReturnType<typeof getArtistDetail>>["targets"]; logs: Awaited<ReturnType<typeof getArtistDetail>>["logs"] }) {
  const qc = useQueryClient();
  const logFn = useServerFn(logDistribution);
  const fanFn = useServerFn(fanOutCanonical);
  const confirmFn = useServerFn(confirmDistribution);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["artist", artistId] });

  const pushOne = useMutation({
    mutationFn: (v: { target: string }) => logFn({ data: { artistId, target: v.target as never, payload_summary: "Manual push logged from UI" } }),
    onSuccess: () => { toast.success("Push logged"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const fanOut = useMutation({
    mutationFn: () => fanFn({ data: { artistId } }),
    onSuccess: (r) => { toast.success(`Fanned out to ${r.pushed} target${r.pushed === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} pending` : ""}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const confirm = useMutation({
    mutationFn: (logId: string) => confirmFn({ data: { logId } }),
    onSuccess: (r) => { toast.success(r.sla_met ? "Confirmed · within SLA" : "Confirmed · SLA missed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalPushes = logs.length;
  const confirmedCount = logs.filter((l) => l.propagation_confirmed_at).length;
  const pendingCount = totalPushes - confirmedCount;
  const slaMetCount = logs.filter((l) => l.sla_met === true).length;
  const slaPct = totalPushes ? Math.round((slaMetCount / totalPushes) * 100) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="flex items-center justify-between rounded-sm border border-border bg-surface px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Fan-out engine</div>
            <div className="mt-0.5 text-sm">Push the current canonical version to every connected target.</div>
          </div>
          <button onClick={() => fanOut.mutate()} disabled={fanOut.isPending}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50">
            {fanOut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Distribute now
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {targets.map((t) => {
            const targetLogs = logs.filter((l) => l.target === t.target);
            return (
              <div key={t.id} className="rounded-sm border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-base">{TARGET_LABELS[t.target] ?? t.target}</div>
                    <div className={`mt-0.5 font-mono text-[10px] uppercase tracking-widest ${
                      t.status === "connected" ? "text-verdict-accurate" :
                      t.status === "manual" ? "text-verdict-stale" :
                      t.status === "error" ? "text-verdict-wrong" : "text-muted-foreground"
                    }`}>{t.status}</div>
                  </div>
                  <button onClick={() => pushOne.mutate({ target: t.target })} disabled={pushOne.isPending}
                    className="rounded-sm border border-border px-2.5 py-1 text-xs hover:bg-surface-elevated disabled:opacity-50">
                    Log push
                  </button>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t.last_pushed_at ? `Last push ${formatDistanceToNow(new Date(t.last_pushed_at))} ago` : "Never pushed"}
                </div>
                {targetLogs.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-border pt-2 font-mono text-[10px]">
                    {targetLogs.slice(0, 3).map((l) => {
                      const status = l.propagation_confirmed_at
                        ? (l.sla_met ? "confirmed · SLA met" : "confirmed · SLA missed")
                        : "pending";
                      const cls = l.propagation_confirmed_at
                        ? (l.sla_met ? "text-verdict-accurate" : "text-verdict-wrong")
                        : "text-verdict-stale";
                      return (
                        <div key={l.id} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{format(new Date(l.pushed_at), "MMM d HH:mm")}</span>
                          <div className="flex items-center gap-2">
                            <span className={cls}>{status}</span>
                            {!l.propagation_confirmed_at && (
                              <button onClick={() => confirm.mutate(l.id)} disabled={confirm.isPending}
                                className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground hover:text-primary">
                                mark
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-sm border border-border bg-surface p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">SLA</div>
          <div className="mt-1 font-display text-3xl">48h</div>
          <p className="mt-2 text-xs text-muted-foreground">
            Every canonical change must propagate to every connected retrieval source within 48 hours. Auto-confirmation runs every 15 minutes.
          </p>
          <div className="mt-4 border-t border-border pt-3 text-xs">
            <div className="mb-1 flex justify-between"><span className="text-muted-foreground">Total pushes</span><span>{totalPushes}</span></div>
            <div className="mb-1 flex justify-between"><span className="text-muted-foreground">Confirmed</span><span className="text-verdict-accurate">{confirmedCount}</span></div>
            <div className="mb-1 flex justify-between"><span className="text-muted-foreground">Pending</span><span className="text-verdict-stale">{pendingCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SLA met</span><span>{slaPct === null ? "—" : `${slaPct}%`}</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* --------------- Dialog --------------- */
function Dialog({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-sm border border-border bg-surface p-6">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Action</div>
        <h2 className="mt-1 mb-4 font-display text-2xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}
