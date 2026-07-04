import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArtists, getArtistDetail } from "@/lib/artists.functions";
import { TARGET_DELAY_HOURS } from "@/lib/distribution.functions";
import { scoreFromRuns, scoreTier, VERDICT_META, type Verdict } from "@/lib/verdict";
import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sla")({
  component: SLAReport,
});

function SLAReport() {
  const listFn = useServerFn(listArtists);
  const artistsQuery = useQuery({ queryKey: ["artists"], queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? artistsQuery.data?.[0]?.id ?? null;
  const detailFn = useServerFn(getArtistDetail);
  const detail = useQuery({
    queryKey: ["artist", activeId],
    queryFn: () => detailFn({ data: { artistId: activeId! } }),
    enabled: !!activeId,
  });

  const monthStart = subDays(new Date(), 30);
  const stats = useMemo(() => {
    if (!detail.data) return null;
    const logs = detail.data.logs.filter((l) => new Date(l.pushed_at) >= monthStart);
    const confirmed = logs.filter((l) => l.propagation_confirmed_at);
    const slaMet = logs.filter((l) => l.sla_met === true);
    const currentRuns = detail.data.runs.filter((r) => new Date(r.run_at) >= monthStart);
    const score = scoreFromRuns(currentRuns as { verdict: Verdict }[]);
    const flagged = currentRuns.filter((r) => r.verdict === "wrong" || r.verdict === "stale").length;
    return { logs, confirmed, slaMet, score, flagged };
  }, [detail.data, monthStart]);

  const targetStats = useMemo(() => {
    if (!stats) return [];
    const byTarget = new Map<string, { pushed: number; confirmed: number; slaMet: number; totalHours: number }>();
    for (const l of stats.logs) {
      const cur = byTarget.get(l.target) ?? { pushed: 0, confirmed: 0, slaMet: 0, totalHours: 0 };
      cur.pushed++;
      if (l.propagation_confirmed_at) {
        cur.confirmed++;
        cur.totalHours += (new Date(l.propagation_confirmed_at).getTime() - new Date(l.pushed_at).getTime()) / 3600_000;
      }
      if (l.sla_met === true) cur.slaMet++;
      byTarget.set(l.target, cur);
    }
    return Array.from(byTarget.entries())
      .map(([target, s]) => {
        const expected = TARGET_DELAY_HOURS[target] ?? null;
        const actual = s.confirmed > 0 ? s.totalHours / s.confirmed : null;
        const drift = expected !== null && actual !== null ? actual - expected : null;
        const slaPct = s.pushed ? Math.round((s.slaMet / s.pushed) * 100) : 0;
        return { target, ...s, expected, actual, drift, slaPct };
      })
      .sort((a, b) => b.pushed - a.pushed);
  }, [stats]);

  function exportCsv() {
    if (!detail.data || !stats) return;
    const rows = [
      ["Artist", detail.data.artist.name],
      ["Period", `${format(monthStart, "yyyy-MM-dd")} → ${format(new Date(), "yyyy-MM-dd")}`],
      ["AI Accuracy Score", stats.score?.toString() ?? "—"],
      ["Pushes", stats.logs.length.toString()],
      ["Confirmed propagation", stats.confirmed.length.toString()],
      ["Within 48h SLA", stats.slaMet.length.toString()],
      ["Flagged answers", stats.flagged.toString()],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sla-${detail.data.artist.name}-${format(new Date(), "yyyy-MM")}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Monthly report</div>
          <h1 className="mt-1 font-display text-3xl">SLA report</h1>
          <p className="mt-1 text-sm text-muted-foreground">The renewal artifact. Ship it to the manager or GM at month end.</p>
        </div>
        {detail.data && (
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-2 text-sm hover:bg-surface-elevated">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <aside>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Artist</div>
          <div className="space-y-1">
            {(artistsQuery.data ?? []).map((a) => (
              <button key={a.id} onClick={() => setSelected(a.id)}
                className={`block w-full rounded-sm px-3 py-2 text-left text-sm ${a.id === activeId ? "bg-surface-elevated text-foreground" : "text-muted-foreground hover:bg-surface"}`}>
                {a.name}
              </button>
            ))}
          </div>
        </aside>

        <div className="lg:col-span-3">
          {!detail.data || !stats ? (
            <div className="text-sm text-muted-foreground">Select an artist.</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="AI Accuracy" value={stats.score === null ? "—" : String(stats.score)} tier={scoreTier(stats.score).color} />
                <Stat label="Pushes / 30d" value={String(stats.logs.length)} />
                <Stat label="Confirmed" value={`${stats.logs.length ? Math.round((stats.confirmed.length / stats.logs.length) * 100) : 0}%`} />
                <Stat label="Within 48h SLA" value={`${stats.logs.length ? Math.round((stats.slaMet.length / stats.logs.length) * 100) : 0}%`} />
              </div>

              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Verdict breakdown (30d)</div>
                <div className="mt-3 space-y-2">
                  {(["accurate","stale","wrong","missing"] as Verdict[]).map((v) => {
                    const count = detail.data!.runs.filter((r) => new Date(r.run_at) >= monthStart && r.verdict === v).length;
                    const total = detail.data!.runs.filter((r) => new Date(r.run_at) >= monthStart).length || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={v}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className={`font-mono uppercase tracking-widest text-verdict-${v}`}>{VERDICT_META[v].label}</span>
                          <span className="text-muted-foreground">{count} · {pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-background">
                          <div className={`h-full bg-verdict-${v}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Per-target SLA (30d)</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Expected → actual · drift</div>
                </div>
                {targetStats.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No push history yet.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead><tr><th>Target</th><th>Pushes</th><th>Confirmed</th><th>Expected</th><th>Actual avg</th><th>Drift</th><th>SLA %</th></tr></thead>
                    <tbody>
                      {targetStats.map((t) => (
                        <tr key={t.target}>
                          <td className="font-mono text-xs uppercase">{t.target.replace(/_/g, " ")}</td>
                          <td className="text-xs">{t.pushed}</td>
                          <td className="text-xs text-muted-foreground">{t.confirmed}/{t.pushed}</td>
                          <td className="font-mono text-xs text-muted-foreground">{t.expected !== null ? fmtHours(t.expected) : "—"}</td>
                          <td className="font-mono text-xs">{t.actual !== null ? fmtHours(t.actual) : "—"}</td>
                          <td className={`font-mono text-xs ${t.drift === null ? "text-muted-foreground" : t.drift > 6 ? "text-verdict-wrong" : t.drift > 1 ? "text-verdict-stale" : "text-verdict-accurate"}`}>
                            {t.drift === null ? "—" : `${t.drift >= 0 ? "+" : ""}${fmtHours(t.drift)}`}
                          </td>
                          <td className={`text-xs ${t.slaPct >= 90 ? "text-verdict-accurate" : t.slaPct >= 70 ? "text-verdict-stale" : "text-verdict-wrong"}`}>{t.slaPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
function fmtHours(h: number): string {
  const abs = Math.abs(h);
  if (abs < 1) return `${Math.round(abs * 60)}m`;
  if (abs < 24) return `${abs.toFixed(1)}h`;
  return `${(abs / 24).toFixed(1)}d`;
}


              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recent pushes</div>
                {stats.logs.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No pushes in the last 30 days.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead><tr><th>When</th><th>Target</th><th>Confirmed</th><th>SLA</th></tr></thead>
                    <tbody>
                      {stats.logs.map((l) => (
                        <tr key={l.id}>
                          <td className="font-mono text-xs text-muted-foreground">{format(new Date(l.pushed_at), "MMM d")}</td>
                          <td className="font-mono text-xs uppercase">{l.target.replace("_", " ")}</td>
                          <td className="text-xs">{l.propagation_confirmed_at ? "Yes" : "Pending"}</td>
                          <td className="text-xs">{l.sla_met === true ? "Met" : l.sla_met === false ? "Missed" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tier }: { label: string; value: string; tier?: string }) {
  return (
    <div className="rounded-sm border border-border bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-3xl ${tier ?? ""}`}>{value}</div>
    </div>
  );
}
