import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyArtistPage,
  saveArtistPage,
  setArtistPagePublished,
  syncArtistPageFromCanonical,
  generateArtistPageWithAI,
} from "@/lib/artist-page.functions";
import { Loader2, ExternalLink, Plus, Trash2, Save, Eye, EyeOff, ArrowLeft, Copy, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/artist-page/$artistId")({
  component: EditPage,
});

interface Card { title: string; description: string; url: string }
interface DateRow { date: string; venue: string; city: string; type: string }
interface Channel { name: string; url: string; description: string }
interface FaqRow { question: string; answer: string }

function EditPage() {
  const { artistId } = Route.useParams();
  const fn = useServerFn(getMyArtistPage);
  const saveFn = useServerFn(saveArtistPage);
  const pubFn = useServerFn(setArtistPagePublished);
  const syncFn = useServerFn(syncArtistPageFromCanonical);
  const aiFn = useServerFn(generateArtistPageWithAI);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["artist-page", artistId],
    queryFn: () => fn({ data: { artistId } }),
  });

  const [slug, setSlug] = useState("");
  const [headline, setHeadline] = useState("");
  const [verifiedQuestions, setVerifiedQuestions] = useState<string>("");
  const [updatedLabel, setUpdatedLabel] = useState("");
  const [startHere, setStartHere] = useState<Card[]>([]);
  const [snapshotHeadline, setSnapshotHeadline] = useState("");
  const [dates, setDates] = useState<DateRow[]>([]);
  const [moreNote, setMoreNote] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [faq, setFaq] = useState<FaqRow[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!q.data || initialized) return;
    const p = q.data.page as any;
    setSlug(p.slug ?? "");
    setHeadline(p.headline ?? "");
    setVerifiedQuestions(p.intro_stats?.verifiedQuestions != null ? String(p.intro_stats.verifiedQuestions) : "");
    setUpdatedLabel(p.intro_stats?.updatedLabel ?? "");
    setStartHere((p.start_here ?? []).map((c: any) => ({ title: c.title ?? "", description: c.description ?? "", url: c.url ?? "" })));
    setSnapshotHeadline(p.live_snapshot?.headline ?? "");
    setDates((p.live_snapshot?.dates ?? []).map((d: any) => ({ date: d.date ?? "", venue: d.venue ?? "", city: d.city ?? "", type: d.type ?? "" })));
    setMoreNote(p.live_snapshot?.moreNote ?? "");
    setChannels((p.official_channels ?? []).map((c: any) => ({ name: c.name ?? "", url: c.url ?? "", description: c.description ?? "" })));
    setFaq((p.faq ?? []).map((f: any) => ({ question: f.question ?? "", answer: f.answer ?? "" })));
    setInitialized(true);
  }, [q.data, initialized]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          artistId,
          content: {
            slug: slug.trim(),
            headline: headline.trim(),
            intro_stats: {
              verifiedQuestions: verifiedQuestions ? Number(verifiedQuestions) : undefined,
              updatedLabel: updatedLabel.trim() || undefined,
            },
            start_here: startHere
              .filter((c) => c.title.trim())
              .map((c) => ({ title: c.title.trim(), description: c.description.trim(), url: c.url.trim() || "" })),
            live_snapshot: {
              headline: snapshotHeadline.trim(),
              dates: dates.filter((d) => d.date.trim()).map((d) => ({ date: d.date.trim(), venue: d.venue.trim(), city: d.city.trim(), type: d.type.trim() })),
              moreNote: moreNote.trim(),
            },
            official_channels: channels
              .filter((c) => c.name.trim() && c.url.trim())
              .map((c) => ({ name: c.name.trim(), url: c.url.trim(), description: c.description.trim() })),
            faq: faq.filter((f) => f.question.trim() && f.answer.trim()).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
          },
        },
      }),
    onSuccess: () => { toast.success("Page saved"); qc.invalidateQueries({ queryKey: ["artist-page", artistId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePublish = useMutation({
    mutationFn: (published: boolean) => pubFn({ data: { artistId, published } }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["artist-page", artistId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoSync = useMutation({
    mutationFn: () => syncFn({ data: { artistId } }),
    onSuccess: (res) => {
      setSnapshotHeadline(res.liveSnapshot.headline ?? "");
      if (res.liveSnapshot.moreNote) setMoreNote(res.liveSnapshot.moreNote);
      // Merge channels: replace any existing entry with same URL, then append new ones.
      setChannels((prev) => {
        const byUrl = new Map(prev.map((c) => [c.url.trim().toLowerCase(), c]));
        for (const c of res.officialChannels) {
          byUrl.set(c.url.trim().toLowerCase(), { name: c.name, url: c.url, description: c.description });
        }
        return Array.from(byUrl.values());
      });
      toast.success("Synced from canonical record. Review and Save.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aiPopulate = useMutation({
    mutationFn: () => aiFn({ data: { artistId } }),
    onSuccess: (res) => {
      if (res.headline) setHeadline(res.headline);
      if (res.snapshotHeadline) setSnapshotHeadline(res.snapshotHeadline);
      if (res.moreNote) setMoreNote(res.moreNote);
      if (res.startHere?.length) {
        setStartHere((prev) => {
          const seen = new Set(prev.map((c) => c.title.trim().toLowerCase()));
          const additions = res.startHere.filter((c) => !seen.has(c.title.trim().toLowerCase()));
          return [...prev, ...additions];
        });
      }
      if (res.faq?.length) {
        setFaq((prev) => {
          const seen = new Set(prev.map((f) => f.question.trim().toLowerCase()));
          const additions = res.faq.filter((f) => !seen.has(f.question.trim().toLowerCase()));
          return [...prev, ...additions];
        });
      }
      toast.success("AI draft populated. Review and Save.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading || !q.data) {
    return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…</div>;
  }

  const published = (q.data.page as any).published as boolean;
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/artist/${slug}` : `/artist/${slug}`;

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link to="/artists/$artistId" params={{ artistId }} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to artist
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Public artist page</div>
            <h1 className="mt-1 font-display text-3xl">{q.data.artist.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Editable brand-facing page for the artist's official site to link to.</p>
          </div>
          <div className="flex items-center gap-2">
            {published && (
              <>
                <a href={`/artist/${slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-elevated">
                  <ExternalLink className="h-4 w-4" /> View
                </a>
                <button onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Link copied"); }} className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-elevated">
                  <Copy className="h-4 w-4" /> Copy link
                </button>
              </>
            )}
            <button
              onClick={() => aiPopulate.mutate()}
              disabled={aiPopulate.isPending}
              title="Draft page copy from available artist data"
              className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-elevated disabled:opacity-50"
            >
              {aiPopulate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate with AI
            </button>
            <button
              onClick={() => togglePublish.mutate(!published)}
              disabled={togglePublish.isPending || (!published && !slug.trim())}
              className={`inline-flex items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold ${published ? "border border-border bg-surface hover:bg-surface-elevated" : "bg-primary text-primary-foreground hover:brightness-110"} disabled:opacity-50`}
            >
              {togglePublish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {published ? "Unpublish" : "Publish"}
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
        {published && (
          <div className="mt-3 rounded-sm border border-border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">{publicUrl}</div>
        )}
      </div>

      {/* URL slug */}
      <Section label="URL slug" hint="Lowercase letters, numbers, and dashes only.">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">/artist/</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className="w-72 rounded-sm border border-border bg-input px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
        </div>
      </Section>

      {/* Share with webmaster */}
      <EmbedSection
        artistName={(q.data as any).artist?.name ?? "this artist"}
        publicUrl={publicUrl}
        published={published}
      />


      {/* Headline */}
      <Section label="Headline paragraph" hint="Shown right under the artist name.">
        <textarea value={headline} onChange={(e) => setHeadline(e.target.value)} rows={3} className="w-full resize-y rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
      </Section>

      {/* Meta chips */}
      <Section label="Header chips">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LabelledInput label="Verified questions" type="number" value={verifiedQuestions} onChange={setVerifiedQuestions} placeholder="6" />
          <LabelledInput label="Updated label" value={updatedLabel} onChange={setUpdatedLabel} placeholder="Jul 4, 2026 (auto if blank)" />
        </div>
      </Section>

      {/* Start here */}
      <Section label="1. Start here — Q&A cards">
        <ListEditor
          items={startHere}
          setItems={setStartHere}
          empty={{ title: "", description: "", url: "" }}
          render={(c, upd) => (
            <>
              <LabelledInput label="Card title" value={c.title} onChange={(v) => upd({ ...c, title: v })} placeholder="What is current with…" />
              <LabelledInput label="Description" value={c.description} onChange={(v) => upd({ ...c, description: v })} placeholder="Right now the official pages show…" />
              <LabelledInput label="Link (optional)" value={c.url} onChange={(v) => upd({ ...c, url: v })} placeholder="https://…" />
            </>
          )}
          addLabel="Add card"
        />
      </Section>

      {/* Snapshot */}
      <Section label="2. Verified live snapshot">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-dashed border-border bg-background/60 p-3">
          <p className="text-xs text-muted-foreground">Pull the latest headline and note from the canonical artist record (Spotify snapshot + latest release).</p>
          <button
            onClick={() => autoSync.mutate()}
            disabled={autoSync.isPending}
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-elevated disabled:opacity-50"
          >
            {autoSync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Auto-sync from canonical
          </button>
        </div>
        <LabelledInput label="Snapshot headline" value={snapshotHeadline} onChange={setSnapshotHeadline} placeholder="34 verified dates. Next stop is…" />
        <div className="mt-4">
          <ListEditor
            items={dates}
            setItems={setDates}
            empty={{ date: "", venue: "", city: "", type: "" }}
            render={(d, upd) => (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <LabelledInput label="Date" value={d.date} onChange={(v) => upd({ ...d, date: v })} placeholder="July 10, 2026" />
                <LabelledInput label="Venue" value={d.venue} onChange={(v) => upd({ ...d, venue: v })} placeholder="Fox Theatre" />
                <LabelledInput label="City" value={d.city} onChange={(v) => upd({ ...d, city: v })} placeholder="Atlanta, GA" />
                <LabelledInput label="Type" value={d.type} onChange={(v) => upd({ ...d, type: v })} placeholder="Theater" />
              </div>
            )}
            addLabel="Add date"
          />
        </div>
        <div className="mt-4">
          <LabelledInput label="Note under the table" value={moreNote} onChange={setMoreNote} placeholder="26 more verified dates on the Tickets page." />
        </div>
      </Section>

      {/* Channels */}
      <Section label="3. Official channels">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-dashed border-border bg-background/60 p-3">
          <p className="text-xs text-muted-foreground">Merge in the artist's official site and verified social links from the canonical record.</p>
          <button
            onClick={() => autoSync.mutate()}
            disabled={autoSync.isPending}
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-elevated disabled:opacity-50"
          >
            {autoSync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Auto-sync from canonical
          </button>
        </div>
        <ListEditor
          items={channels}
          setItems={setChannels}
          empty={{ name: "", url: "", description: "" }}
          render={(c, upd) => (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <LabelledInput label="Channel" value={c.name} onChange={(v) => upd({ ...c, name: v })} placeholder="Official site" />
              <LabelledInput label="URL" value={c.url} onChange={(v) => upd({ ...c, url: v })} placeholder="https://…" />
              <LabelledInput label="What it is" value={c.description} onChange={(v) => upd({ ...c, description: v })} placeholder="Official artist website." />
            </div>
          )}
          addLabel="Add channel"
        />
      </Section>

      {/* FAQ */}
      <Section label="4. FAQ">
        <ListEditor
          items={faq}
          setItems={setFaq}
          empty={{ question: "", answer: "" }}
          render={(f, upd) => (
            <>
              <LabelledInput label="Question" value={f.question} onChange={(v) => upd({ ...f, question: v })} placeholder="Is Artist on tour?" />
              <LabelledTextarea label="Answer" value={f.answer} onChange={(v) => upd({ ...f, answer: v })} rows={3} />
            </>
          )}
          addLabel="Add question"
        />
      </Section>

      <div className="flex justify-end pt-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

// ---- Reusable field bits ---------------------------------------------------

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface p-5">
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Section</div>
        <h2 className="mt-0.5 font-display text-lg">{label}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function LabelledInput({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}

function LabelledTextarea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-sm border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}

function ListEditor<T>({
  items,
  setItems,
  empty,
  render,
  addLabel,
}: {
  items: T[];
  setItems: (v: T[]) => void;
  empty: T;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
  addLabel: string;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-sm border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Item {i + 1}</span>
            <button
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="rounded-sm p-1 text-muted-foreground hover:bg-surface-elevated hover:text-destructive"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {render(item, (next) => setItems(items.map((v, j) => (j === i ? next : v))))}
          </div>
        </div>
      ))}
      <button
        onClick={() => setItems([...items, { ...empty }])}
        className="inline-flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  );
}
