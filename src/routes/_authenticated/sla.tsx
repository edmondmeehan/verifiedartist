import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArtists, getArtistDetail } from "@/lib/artists.functions";
import { listVerifications, TARGET_LABELS } from "@/lib/distribution.functions";
import type { ClassifiedLink } from "@/lib/links";
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
  const activeId = selected ?? artistsQuery.data?.[0]?.id ?? null;
  const detailFn = useServerFn(getArtistDetail);
  const detail = useQuery({
    queryKey: ["artist", activeId],
    queryFn: () => detailFn({ data: { artistId: activeId! } }),
    enabled: !!activeId,
  });
  const verFn = useServerFn(listVerifications);
  const verQuery = useQuery({
    queryKey: ["verifications-report", activeId],
    queryFn: () => verFn({ data: { artistId: activeId!, limit: 200 } }),
    enabled: !!activeId,
  });

  const stats = useMemo(() => {
    if (!detail.data) return null;
    const inRange = (iso: string) => { const d = new Date(iso); return !isBefore(d, from) && !isAfter(d, to); };
    const updates = (verQuery.data ?? []).filter((v) => inRange(v.created_at) && v.status !== "superseded");
    const decided = updates.filter((v) => v.status === "verified" || v.status === "missed");
    const verified48 = decided.filter((v) => v.status === "verified" && v.verified_at
      && new Date(v.verified_at).getTime() - new Date(v.created_at).getTime() <= 48 * 3600_000);
    const logs = detail.data.logs.filter((l) => inRange(l.pushed_at));
    const openTasks = logs.filter((l) => l.delivery_status === "manual_task");
    const currentRuns = detail.data.runs.filter((r) => inRange(r.run_at));
    const score = scoreFromRuns(currentRuns as { verdict: Verdict }[]);
    const flagged = currentRuns.filter((r) => r.verdict === "wrong" || r.verdict === "stale").length;
    let official = 0, primary = 0, resale = 0;
    for (const r of currentRuns) for (const l of ((r.links ?? []) as unknown as ClassifiedLink[])) {
      if (l.kind === "official") official++; else if (l.kind === "primary") primary++; else if (l.kind === "resale") resale++;
    }
    const buy = official + primary + resale;
    const resalePct = buy ? Math.round((resale / buy) * 100) : null;
    return { updates, decided, verified48, logs, openTasks, score, flagged, runs: currentRuns, resalePct };
  }, [detail.data, verQuery.data, from, to]);

  const targetStats = useMemo(() => {
    if (!stats) return [];
    const byTarget = new Map<string, { pushed: number; doneManual: number; open: number; failed: number }>();
    for (const l of stats.logs) {
      const cur = byTarget.get(l.target) ?? { pushed: 0, doneManual: 0, open: 0, failed: 0 };
      if (l.delivery_status === "delivered") cur.pushed++;
      else if (l.delivery_status === "done_manual") cur.doneManual++;
      else if (l.delivery_status === "manual_task") cur.open++;
      else if (l.delivery_status === "failed") cur.failed++;
      byTarget.set(l.target, cur);
    }
    return Array.from(byTarget.entries()).map(([target, s]) => ({ target, ...s }));
  }, [stats]);

  function exportCsv() {
    if (!detail.data || !stats) return;
    const rows = [
      ["Artist", detail.data.artist.name],
      ["Period", `${format(from, "yyyy-MM-dd")} → ${format(to, "yyyy-MM-dd")}`],
      ["AI Accuracy Score", stats.score?.toString() ?? "—"],
      ["Updates distributed", stats.updates.length.toString()],
      ["Updates verified by AI re-check within 48h", `${stats.verified48.length} of ${stats.decided.length}`],
      ["Open manual tasks", stats.openTasks.length.toString()],
      ["Flagged answers", stats.flagged.toString()],
      ["Share of ticket links pointing to resale", stats.resalePct === null ? "—" : `${stats.resalePct}%`],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${detail.data.artist.name}-${format(from, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">SLA report</div>
          <h1 className="mt-1 font-display text-3xl">Monthly report</h1>
          <p className="mt-1 text-sm text-muted-foreground">What AI said, what we fixed, and whether the fix showed up in AI answers. Every number comes from a real audit.</p>
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
                <Stat label="Updates distributed" value={String(stats.updates.length)} />
                <Stat label="AI verified ≤48h" value={stats.decided.length ? `${stats.verified48.length}/${stats.decided.length}` : "—"} />
                <Stat label="Ticket links to resale" value={stats.resalePct === null ? "—" : `${stats.resalePct}%`} tier={stats.resalePct ? "text-verdict-wrong" : undefined} />
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
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Updates & AI verification</div>
                {stats.updates.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No updates distributed in this period.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead>
                      <tr><th>Distributed</th><th>Change</th><th>Result</th><th>Time to verify</th><th>Last check</th></tr>
                    </thead>
                    <tbody>
                      {stats.updates.map((v) => {
                        const r = (v.last_result ?? {}) as { accurate?: number; answers?: number };
                        const hours = v.verified_at ? (new Date(v.verified_at).getTime() - new Date(v.created_at).getTime()) / 3600_000 : null;
                        const cls = v.status === "verified" ? "text-verdict-accurate" : v.status === "missed" ? "text-verdict-wrong" : "text-verdict-stale";
                        return (
                          <tr key={v.id}>
                            <td className="font-mono text-xs text-muted-foreground">{format(new Date(v.created_at), "MMM d HH:mm")}</td>
                            <td className="text-xs">{v.change_summary}</td>
                            <td className={`font-mono text-xs uppercase ${cls}`}>{v.status === "pending" ? "awaiting check" : v.status}</td>
                            <td className="font-mono text-xs">{hours !== null ? fmtHours(hours) : "—"}</td>
                            <td className="text-xs text-muted-foreground">{v.last_checked_at ? `${r.accurate ?? 0}/${r.answers ?? 0} accurate` : "Not checked yet"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-6 rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Delivery by platform</div>
                {targetStats.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">No distribution in this period.</div>
                ) : (
                  <table className="data-table mt-3">
                    <thead><tr><th>Platform</th><th>Pushed automatically</th><th>Manual · done</th><th>Manual · open</th><th>Failed</th></tr></thead>
                    <tbody>
                      {targetStats.map((t) => (
                        <tr key={t.target}>
                          <td className="text-xs">{TARGET_LABELS[t.target] ?? t.target}</td>
                          <td className="text-xs">{t.pushed}</td>
                          <td className="text-xs">{t.doneManual}</td>
                          <td className={`text-xs ${t.open ? "text-verdict-stale" : ""}`}>{t.open}</td>
                          <td className={`text-xs ${t.failed ? "text-verdict-wrong" : ""}`}>{t.failed}</td>
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
