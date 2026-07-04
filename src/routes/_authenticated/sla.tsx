import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArtists, getArtistDetail } from "@/lib/artists.functions";
import { TARGET_DELAY_HOURS } from "@/lib/distribution.functions";
import { scoreFromRuns, scoreTier, VERDICT_META, type Verdict } from "@/lib/verdict";
import { useMemo, useState } from "react";
import { format, subDays, startOfDay, endOfDay, isAfter, isBefore } from "date-fns";
import { Download, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const DEFAULT_RANGE_DAYS = 30;

function parseSearchDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

export const Route = createFileRoute("/_authenticated/sla")({
  validateSearch: (search) => {
    const today = endOfDay(new Date());
    const fromRaw = parseSearchDate(search.from);
    const toRaw = parseSearchDate(search.to);
    let from = fromRaw ? startOfDay(fromRaw) : startOfDay(subDays(new Date(), DEFAULT_RANGE_DAYS - 1));
    let to = toRaw ? endOfDay(toRaw) : today;
    if (isAfter(from, to)) {
      from = startOfDay(to);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  },
  component: SLAReport,
});

function SLAReport() {
  const search = Route.useSearch();
  const from = startOfDay(new Date(search.from));
  const to = endOfDay(new Date(search.to));
  const periodLabel = `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;

  const navigate = useNavigate({ from: "/sla" });
  const updateRange = (patch: { from?: Date; to?: Date }) => {
    navigate({
      search: (prev: { from: string; to: string }) => {
        const next = { ...prev };
        if (patch.from) next.from = startOfDay(patch.from).toISOString();
        if (patch.to) next.to = endOfDay(patch.to).toISOString();
        return next;
      },
    });
  };

  const listFn = useServerFn(listArtists);
  const artistsQuery = useQuery({ queryKey: ["artists"], queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const activeId = selected ?? artistsQuery.data?.[0]?.id ?? null;
  const detailFn = useServerFn(getArtistDetail);
  const detail = useQuery({
    queryKey: ["artist", activeId],
    queryFn: () => detailFn({ data: { artistId: activeId! } }),
    enabled: !!activeId,
  });

  const stats = useMemo(() => {
    if (!detail.data) return null;
    const logs = detail.data.logs.filter((l) => {
      const pushed = new Date(l.pushed_at);
      return !isBefore(pushed, from) && !isAfter(pushed, to);
    });
    const confirmed = logs.filter((l) => l.propagation_confirmed_at);
    const slaMet = logs.filter((l) => l.sla_met === true);
    const currentRuns = detail.data.runs.filter((r) => {
      const runAt = new Date(r.run_at);
      return !isBefore(runAt, from) && !isAfter(runAt, to);
    });
    const score = scoreFromRuns(currentRuns as { verdict: Verdict }[]);
    const flagged = currentRuns.filter((r) => r.verdict === "wrong" || r.verdict === "stale").length;
    return { logs, confirmed, slaMet, score, flagged, runs: currentRuns };
  }, [detail.data, from, to]);

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
      ["Period", `${format(from, "yyyy-MM-dd")} → ${format(to, "yyyy-MM-dd")}`],
      ["AI Accuracy Score", stats.score?.toString() ?? "—"],
      ["Pushes", stats.logs.length.toString()],
      ["Confirmed propagation", stats.confirmed.length.toString()],
      ["Within 48h SLA", stats.slaMet.length.toString()],
      ["Flagged answers", stats.flagged.toString()],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla-${detail.data.artist.name}-${format(from, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">SLA report</div>
          <h1 className="mt-1 font-display text-3xl">Distribution SLA</h1>
          <p className="mt-1 text-sm text-muted-foreground">The renewal artifact. Ship it to the manager or GM at month end.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker from={from} to={to} onChange={updateRange} />
          {detail.data && (
            <Button onClick={exportCsv} variant="outline" className="inline-flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <aside>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Artist</div>
          <div className="space-y-1">
            {(artistsQuery.data ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a.id)}
                className={`block w-full rounded-sm px-3 py-2 text-left text-sm ${a.id === activeId ? "bg-surface-elevated text-foreground" : "text-muted-foreground hover:bg-surface"}`}
              >
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
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{periodLabel}</div>
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="AI Accuracy" value={stats.score === null ? "—" : String(stats.score)} tier={scoreTier(stats.score).color} />
                <Stat label="Pushes" value={String(stats.logs.length)} />
                <Stat label="Confirmed" value={`${stats.logs.length ? Math.round((stats.confirmed.length / stats.logs.length) * 100) : 0}%`} />
                <Stat label="Within 48h SLA" value={`${stats.logs.length ? Math.round((stats.slaMet.length / stats.logs.length) * 100) : 0}%`} />
              </div>

              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Verdict breakdown</div>
                <div className="mt-3 space-y-2">
                  {(["accurate", "stale", "wrong", "missing"] as Verdict[]).map((v) => {
                    const count = stats.runs.filter((r) => r.verdict === v).length;
                    const total = stats.runs.length || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={v}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className={`font-mono uppercase tracking-widest text-verdict-${v}`}>{VERDICT_META[v].label}</span>
                          <span className="text-muted-foreground">
                            {count} · {pct}%
                          </span>
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
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Per-target SLA</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Click a row for push timeline</div>
                </div>
                {targetStats.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No push history in this period.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Pushes</th>
                        <th>Confirmed</th>
                        <th>Expected</th>
                        <th>Actual avg</th>
                        <th>Drift</th>
                        <th>SLA %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetStats.map((t) => {
                        const isOpen = expandedTarget === t.target;
                        return (
                          <>
                            <tr
                              key={t.target}
                              onClick={() => setExpandedTarget(isOpen ? null : t.target)}
                              className={`cursor-pointer hover:bg-surface-elevated ${isOpen ? "bg-surface-elevated" : ""}`}
                            >
                              <td className="font-mono text-xs uppercase">
                                <span className="mr-1 inline-block w-3 text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                                {t.target.replace(/_/g, " ")}
                              </td>
                              <td className="text-xs">{t.pushed}</td>
                              <td className="text-xs text-muted-foreground">
                                {t.confirmed}/{t.pushed}
                              </td>
                              <td className="font-mono text-xs text-muted-foreground">{t.expected !== null ? fmtHours(t.expected) : "—"}</td>
                              <td className="font-mono text-xs">{t.actual !== null ? fmtHours(t.actual) : "—"}</td>
                              <td
                                className={`font-mono text-xs ${
                                  t.drift === null ? "text-muted-foreground" : t.drift > 6 ? "text-verdict-wrong" : t.drift > 1 ? "text-verdict-stale" : "text-verdict-accurate"
                                }`}
                              >
                                {t.drift === null ? "—" : `${t.drift >= 0 ? "+" : ""}${fmtHours(t.drift)}`}
                              </td>
                              <td className={`text-xs ${t.slaPct >= 90 ? "text-verdict-accurate" : t.slaPct >= 70 ? "text-verdict-stale" : "text-verdict-wrong"}`}>{t.slaPct}%</td>
                            </tr>
                            {isOpen && (
                              <tr key={`${t.target}-detail`}>
                                <td colSpan={7} className="bg-background p-0">
                                  <TargetTimeline
                                    target={t.target}
                                    expected={t.expected}
                                    logs={stats.logs.filter((l) => l.target === t.target)}
                                  />
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Recent pushes</div>
                {stats.logs.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No pushes in this period.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Target</th>
                        <th>Confirmed</th>
                        <th>SLA</th>
                      </tr>
                    </thead>
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

function DateRangePicker({ from, to, onChange }: { from: Date; to: Date; onChange: (range: { from?: Date; to?: Date }) => void }) {
  return (
    <div className="flex items-center gap-2">
      <DatePicker label="From" value={from} onChange={(d) => onChange({ from: d })} />
      <span className="text-muted-foreground">→</span>
      <DatePicker label="To" value={to} onChange={(d) => onChange({ to: d })} />
    </div>
  );
}

function DatePicker({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-[140px] justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "MMM d, yyyy") : <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
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

function fmtHours(h: number): string {
  const abs = Math.abs(h);
  if (abs < 1) return `${Math.round(abs * 60)}m`;
  if (abs < 24) return `${abs.toFixed(1)}h`;
  return `${(abs / 24).toFixed(1)}d`;
}

type TimelineLog = {
  id: string;
  target: string;
  pushed_at: string;
  propagation_confirmed_at: string | null;
  sla_met: boolean | null;
};

function TargetTimeline({ target, expected, logs }: { target: string; expected: number | null; logs: TimelineLog[] }) {
  const sorted = [...logs].sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {target.replace(/_/g, " ")} · push timeline
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Expected {expected !== null ? fmtHours(expected) : "—"} · SLA 48h
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground">No pushes.</div>
      ) : (
        <ol className="space-y-2">
          {sorted.map((l) => {
            const pushed = new Date(l.pushed_at);
            const confirmed = l.propagation_confirmed_at ? new Date(l.propagation_confirmed_at) : null;
            const elapsedH = confirmed ? (confirmed.getTime() - pushed.getTime()) / 3600_000 : null;
            const drift = elapsedH !== null && expected !== null ? elapsedH - expected : null;
            const verdict: "met" | "missed" | "pending" =
              l.sla_met === true ? "met" : l.sla_met === false ? "missed" : "pending";
            const verdictClass =
              verdict === "met" ? "text-verdict-accurate" : verdict === "missed" ? "text-verdict-wrong" : "text-muted-foreground";
            return (
              <li key={l.id} className="grid grid-cols-12 items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2">
                <div className="col-span-3 font-mono text-[11px] text-muted-foreground">
                  <div>Pushed</div>
                  <div className="text-foreground">{format(pushed, "MMM d, HH:mm")}</div>
                </div>
                <div className="col-span-3 font-mono text-[11px] text-muted-foreground">
                  <div>Confirmed</div>
                  <div className={confirmed ? "text-foreground" : ""}>
                    {confirmed ? format(confirmed, "MMM d, HH:mm") : "— pending —"}
                  </div>
                </div>
                <div className="col-span-2 font-mono text-[11px] text-muted-foreground">
                  <div>Elapsed</div>
                  <div className="text-foreground">{elapsedH !== null ? fmtHours(elapsedH) : "—"}</div>
                </div>
                <div className="col-span-2 font-mono text-[11px] text-muted-foreground">
                  <div>Drift</div>
                  <div
                    className={
                      drift === null
                        ? ""
                        : drift > 6
                          ? "text-verdict-wrong"
                          : drift > 1
                            ? "text-verdict-stale"
                            : "text-verdict-accurate"
                    }
                  >
                    {drift === null ? "—" : `${drift >= 0 ? "+" : ""}${fmtHours(drift)}`}
                  </div>
                </div>
                <div className={`col-span-2 text-right font-mono text-[11px] uppercase tracking-widest ${verdictClass}`}>
                  {verdict}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
