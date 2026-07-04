import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  generateArtistReport,
  generateAuditReport,
  generateRosterReport,
  generateCustomReport,
  listAdminScope,
} from "@/lib/reports.functions";
import { Loader2, FileText, Users, ClipboardCheck, PenLine, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function downloadBase64(base64: string, mime: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportsPage() {
  const scopeFn = useServerFn(listAdminScope);
  const scopeQ = useQuery({ queryKey: ["reports-scope"], queryFn: () => scopeFn() });

  if (scopeQ.isLoading || !scopeQ.data) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const { orgs, artists } = scopeQ.data;

  if (orgs.length === 0) {
    return (
      <div className="p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Reports</div>
        <h1 className="mt-1 font-display text-3xl">No access</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          You need to be an owner or admin of an organization to generate reports.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Reports</div>
        <h1 className="mt-1 font-display text-3xl">Generate PDFs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview and download branded PDF reports. Emailing to clients is coming next.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ArtistReportCard artists={artists} />
        <AuditReportCard artists={artists} />
        <RosterReportCard orgs={orgs} />
        <CustomReportCard orgs={orgs} />
      </div>
    </div>
  );
}

// ---- Cards ------------------------------------------------------------------

function Card({ icon: Icon, title, description, children }: { icon: any; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-sm bg-surface-elevated p-2 text-primary"><Icon className="h-4 w-4" /></div>
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">PDF</div>
          <h2 className="mt-0.5 font-display text-lg">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function GenerateButton({ pending, disabled, onClick }: { pending: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Generate & download
    </button>
  );
}

function ArtistReportCard({ artists }: { artists: Array<{ id: string; name: string }> }) {
  const fn = useServerFn(generateArtistReport);
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const m = useMutation({
    mutationFn: () => fn({ data: { artistId } }),
    onSuccess: (r) => { downloadBase64(r.base64, r.mime, r.filename); toast.success("Report generated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card icon={FileText} title="Artist report" description="Snapshot of one artist: Spotify data, canonical facts, latest audit.">
      <select
        value={artistId}
        onChange={(e) => setArtistId(e.target.value)}
        className="mb-3 w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {artists.length === 0 && <option value="">No artists</option>}
        {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <GenerateButton pending={m.isPending} disabled={!artistId} onClick={() => m.mutate()} />
    </Card>
  );
}

function AuditReportCard({ artists }: { artists: Array<{ id: string; name: string }> }) {
  const fn = useServerFn(generateAuditReport);
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const m = useMutation({
    mutationFn: () => fn({ data: { artistId } }),
    onSuccess: (r) => { downloadBase64(r.base64, r.mime, r.filename); toast.success("Report generated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card icon={ClipboardCheck} title="Audit report" description="Latest audit run findings and verdict counts for one artist.">
      <select
        value={artistId}
        onChange={(e) => setArtistId(e.target.value)}
        className="mb-3 w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {artists.length === 0 && <option value="">No artists</option>}
        {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <GenerateButton pending={m.isPending} disabled={!artistId} onClick={() => m.mutate()} />
    </Card>
  );
}

function RosterReportCard({ orgs }: { orgs: Array<{ id: string; name: string; role: string }> }) {
  const fn = useServerFn(generateRosterReport);
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const m = useMutation({
    mutationFn: () => fn({ data: { orgId } }),
    onSuccess: (r) => { downloadBase64(r.base64, r.mime, r.filename); toast.success("Report generated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card icon={Users} title="Roster summary" description="All artists in an organization with followers, popularity, and sync freshness.">
      <select
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        className="mb-3 w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <GenerateButton pending={m.isPending} disabled={!orgId} onClick={() => m.mutate()} />
    </Card>
  );
}

function CustomReportCard({ orgs }: { orgs: Array<{ id: string; name: string; role: string }> }) {
  const fn = useServerFn(generateCustomReport);
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () =>
      fn({
        data: {
          orgId,
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          sections: [{ body: body.trim() }],
        },
      }),
    onSuccess: (r) => { downloadBase64(r.base64, r.mime, r.filename); toast.success("Report generated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card icon={PenLine} title="Custom report" description="Freeform title, subtitle, and body. Blank lines separate paragraphs.">
      <div className="space-y-2">
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Subtitle (optional)"
          className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Report body. Separate paragraphs with a blank line."
          rows={6}
          className="w-full resize-y rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="mt-3">
        <GenerateButton pending={m.isPending} disabled={!orgId || !title.trim() || !body.trim()} onClick={() => m.mutate()} />
      </div>
    </Card>
  );
}
