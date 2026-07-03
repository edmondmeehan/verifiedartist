import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listArtists, getArtistDetail } from "@/lib/artists.functions";
import { AGENT_LABELS, VERDICT_META, type Verdict } from "@/lib/verdict";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { VerdictBadge } from "@/components/verdict-badge";

export const Route = createFileRoute("/_authenticated/audits")({
  component: AuditsHistory,
});

function AuditsHistory() {
  const listFn = useServerFn(listArtists);
  const artistsQuery = useQuery({ queryKey: ["artists"], queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? artistsQuery.data?.[0]?.id ?? null;

  const detailFn = useServerFn(getArtistDetail);
  const detailQuery = useQuery({
    queryKey: ["artist", activeId],
    queryFn: () => detailFn({ data: { artistId: activeId! } }),
    enabled: !!activeId,
  });

  const chartData = useMemo(() => {
    if (!detailQuery.data) return [];
    const byDay = new Map<string, { day: string; scoreSum: number; count: number }>();
    for (const r of detailQuery.data.runs) {
      const day = format(new Date(r.run_at), "yyyy-MM-dd");
      const weight = VERDICT_META[r.verdict as Verdict]?.weight ?? 0;
      const entry = byDay.get(day) ?? { day, scoreSum: 0, count: 0 };
      entry.scoreSum += weight; entry.count += 1;
      byDay.set(day, entry);
    }
    return Array.from(byDay.values())
      .map((e) => ({ day: e.day, score: Math.round(e.scoreSum / e.count) }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [detailQuery.data]);

  return (
    <div className="p-8">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Timeline</div>
      <h1 className="mt-1 font-display text-3xl">Audit history</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every audit run, per agent, per query — with the score trend.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <aside className="lg:col-span-1">
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
          {!detailQuery.data ? (
            <div className="text-sm text-muted-foreground">Select an artist.</div>
          ) : (
            <>
              <div className="rounded-sm border border-border bg-surface p-5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Score trend</div>
                <h3 className="mt-1 font-display text-lg">{detailQuery.data.artist.name}</h3>
                <div className="mt-4 h-56">
                  {chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No audit runs yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} />
                        <YAxis domain={[0, 100]} stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                        <Line type="monotone" dataKey="score" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-sm border border-border">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th><th>Agent</th><th>Question</th><th>Verdict</th><th>Staleness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQuery.data.runs.map((r) => {
                      const q = detailQuery.data.queries.find((x) => x.id === r.query_id);
                      return (
                        <tr key={r.id}>
                          <td className="font-mono text-xs text-muted-foreground">{format(new Date(r.run_at), "MMM d, HH:mm")}</td>
                          <td><span className="font-mono text-xs uppercase">{AGENT_LABELS[r.agent as keyof typeof AGENT_LABELS] ?? r.agent}</span></td>
                          <td className="text-xs">{q?.query_text ?? "—"}</td>
                          <td><VerdictBadge verdict={r.verdict as Verdict} /></td>
                          <td className="font-mono text-xs text-muted-foreground">{r.staleness_days != null ? `${r.staleness_days}d` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {artistsQuery.data && artistsQuery.data.length === 0 && (
        <div className="mt-8 rounded-sm border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No artists yet. <Link to="/dashboard" className="text-primary">Add one</Link>.
        </div>
      )}
    </div>
  );
}
