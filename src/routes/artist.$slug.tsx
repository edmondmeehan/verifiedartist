import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getPublicArtistPage } from "@/lib/artist-page.functions";

const publicPageQuery = (slug: string) =>
  queryOptions({
    queryKey: ["public-artist-page", slug],
    queryFn: () => getPublicArtistPage({ data: { slug } }),
  });

export const Route = createFileRoute("/artist/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(publicPageQuery(params.slug));
    if (!data) throw notFound();
    return { page: data };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Artist page not found" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const p = loaderData.page;
    const title = `${p.artist.name} — Artist Hub`;
    const description = (p.headline || `Verified information for ${p.artist.name}.`).slice(0, 160);
    const feed = `/api/public/artist/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        ...(p.artist.imageUrl ? [{ property: "og:image", content: p.artist.imageUrl }] : []),
        { name: "twitter:card", content: p.artist.imageUrl ? "summary_large_image" : "summary" },
        // AI-crawler hints: this page welcomes every major agent.
        { name: "robots", content: "all" },
        { name: "googlebot", content: "all" },
      ],
      links: [
        // Answer-object feed — machine-readable for AI systems / MCP tools.
        { rel: "alternate", type: "application/json", href: feed, title: "Answer objects (JSON)" },
        { rel: "alternate", type: "text/markdown", href: `${feed}?format=md`, title: "Answer objects (Markdown)" },
      ],
    };
  },

  component: PublicArtistPage,
  notFoundComponent: ArtistNotFound,
  errorComponent: () => (
    <PageShell>
      <p style={{ color: MUTED }}>Something went wrong loading this page.</p>
    </PageShell>
  ),
});

// ---- Palette ---------------------------------------------------------------

const BG = "#FBF7F0";
const INK = "#171613";
const MUTED = "#6B6555";
const RULE = "#E7DFD0";
const ACCENT = "#E86A55";
const CARD = "#FFFFFF";

// ---- Layout ---------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: "100vh", color: INK, fontFamily: 'Georgia, "Times New Roman", serif' }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 24px 64px" }}>
        {children}
      </div>
    </div>
  );
}

function ArtistNotFound() {
  return (
    <PageShell>
      <div style={{ paddingTop: 80, textAlign: "center" }}>
        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, letterSpacing: 2, color: MUTED, textTransform: "uppercase" }}>
          Artist Hub
        </div>
        <h1 style={{ fontSize: 40, margin: "12px 0 8px" }}>Not found</h1>
        <p style={{ color: MUTED }}>This artist page doesn't exist or hasn't been published yet.</p>
      </div>
    </PageShell>
  );
}

// ---- Page -----------------------------------------------------------------

function PublicArtistPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(publicPageQuery(slug));
  if (!data) return <ArtistNotFound />;

  const {
    artist,
    headline,
    introStats,
    startHere,
    liveSnapshot,
    officialChannels,
    faq,
    updatedAt,
  } = data;

  const updatedLabel =
    introStats?.updatedLabel ||
    new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // JSON-LD for AI crawlers (ChatGPT, Claude, Perplexity, Gemini) to cite.
  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "MusicGroup",
      name: artist.name,
      ...(artist.imageUrl ? { image: artist.imageUrl } : {}),
      ...(artist.officialSiteUrl ? { url: artist.officialSiteUrl } : {}),
      ...(headline ? { description: headline } : {}),
      ...(officialChannels.length
        ? { sameAs: officialChannels.map((c: any) => c.url).filter(Boolean) }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${artist.name} — Artist Hub`,
      dateModified: updatedAt,
      inLanguage: "en",
      about: { "@type": "MusicGroup", name: artist.name },
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: ["h1", "h2", "p"],
      },
    },
  ];
  if (faq.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f: any) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }


  return (
    <PageShell>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Nav strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1px solid ${RULE}`, borderRadius: 4, background: CARD, marginBottom: 40, flexWrap: "wrap" }}>
        <TagChip label="Artist" muted />
        <TagChip label={artist.name} accent />
        <div style={{ width: 1, height: 20, background: RULE, margin: "0 8px" }} />
        <TagChip label="Start here" muted />
        <ChannelChip label="Current" />
        <ChannelChip label="Tickets" />
        <ChannelChip label="Show guide" />
        <ChannelChip label="Music" />
        <ChannelChip label="Merch" />
        <ChannelChip label="Tour dates" />
      </div>

      {/* Header */}
      <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, letterSpacing: 2, color: ACCENT, textTransform: "uppercase" }}>
        Artist Hub
      </div>
      <h1 style={{ fontSize: 56, lineHeight: 1.05, margin: "12px 0 20px", fontWeight: 700 }}>
        {artist.name}
      </h1>
      {headline && (
        <p style={{ fontSize: 18, lineHeight: 1.55, color: INK, maxWidth: 820, margin: 0 }}>{headline}</p>
      )}

      {/* Meta chips */}
      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        {typeof introStats?.verifiedQuestions === "number" && (
          <MetaChip label={`${introStats.verifiedQuestions} verified questions`} />
        )}
        <MetaChip label={`Updated ${updatedLabel}`} />
      </div>

      {/* Section 1 — Start here */}
      {startHere.length > 0 && (
        <>
          <SectionHeading number={1} title="Start here" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {startHere.map((card: any, i: number) => (
              <a
                key={i}
                href={card.url || undefined}
                target={card.url ? "_blank" : undefined}
                rel={card.url ? "noopener noreferrer" : undefined}
                style={{
                  display: "block",
                  padding: 18,
                  border: `1px solid ${RULE}`,
                  borderRadius: 4,
                  background: CARD,
                  color: INK,
                  textDecoration: "none",
                  cursor: card.url ? "pointer" : "default",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.35, marginBottom: 6 }}>
                  {card.title}
                </div>
                {card.description && (
                  <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>{card.description}</div>
                )}
              </a>
            ))}
          </div>
        </>
      )}

      {/* Section 2 — Verified live snapshot */}
      {(liveSnapshot?.headline || (liveSnapshot?.dates ?? []).length > 0) && (
        <>
          <SectionHeading number={2} title="Verified live snapshot" />
          {liveSnapshot.headline && (
            <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, margin: "0 0 16px" }}>
              {liveSnapshot.headline}
            </p>
          )}
          {(liveSnapshot.dates ?? []).length > 0 && (
            <Table headers={["Date", "Venue", "City", "Type", "Tickets"]}>
              {liveSnapshot.dates.map((d: any, i: number) => {
                const host = d.ticketUrl ? (() => { try { return new URL(d.ticketUrl).hostname.replace(/^www\./, ""); } catch { return "Tickets"; } })() : null;
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${RULE}` }}>
                    <Td>{d.date}</Td>
                    <Td>{d.venue}</Td>
                    <Td>{d.city}</Td>
                    <Td>{d.type}</Td>
                    <Td>
                      {d.ticketUrl ? (
                        <a href={d.ticketUrl} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: "underline" }}>
                          {host}
                        </a>
                      ) : (
                        <span style={{ color: MUTED }}>—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}

          {liveSnapshot.moreNote && (
            <p style={{ fontSize: 14, color: MUTED, marginTop: 12 }}>{liveSnapshot.moreNote}</p>
          )}
        </>
      )}

      {/* Section 3 — Official channels */}
      {officialChannels.length > 0 && (
        <>
          <SectionHeading number={3} title="Official channels" />
          <Table headers={["Channel", "URL", "What it is"]}>
            {officialChannels.map((c: any, i: number) => (
              <tr key={i} style={{ borderTop: `1px solid ${RULE}` }}>
                <Td>{c.name}</Td>
                <Td>
                  <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: "underline" }}>
                    {c.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </Td>
                <Td>{c.description}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* Section 4 — FAQ */}
      {faq.length > 0 && (
        <>
          <SectionHeading number={4} title="FAQ" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {faq.map((row: any, i: number) => (
              <div key={i}>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{row.question}</div>
                <div style={{ fontSize: 15, lineHeight: 1.6, color: INK }}>{row.answer}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* For-agents strip — inspired by New Lore's "same answer, every format" */}
      <div style={{ marginTop: 56, padding: 16, border: `1px dashed ${RULE}`, borderRadius: 4, background: "#FFFDF8" }}>
        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, letterSpacing: 2, color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
          For AI agents
        </div>
        <div style={{ fontSize: 14, color: INK, lineHeight: 1.55 }}>
          Every answer on this page is also available as a machine-readable answer object:{" "}
          <a href={`/api/public/artist/${slug}`} style={{ color: ACCENT, textDecoration: "underline" }}>JSON feed</a>
          {" · "}
          <a href={`/api/public/artist/${slug}?format=md`} style={{ color: ACCENT, textDecoration: "underline" }}>Markdown</a>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, paddingTop: 20, borderTop: `1px solid ${RULE}`, fontSize: 13, color: MUTED, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span>Last updated {updatedLabel}</span>
        {artist.officialSiteUrl && (
          <a href={artist.officialSiteUrl} target="_blank" rel="noopener noreferrer" style={{ color: MUTED, textDecoration: "underline" }}>
            {artist.officialSiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
      </div>

    </PageShell>
  );
}

// ---- Bits -----------------------------------------------------------------

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <h2 style={{ fontSize: 28, fontWeight: 700, margin: "56px 0 20px" }}>
      {number}. {title}
    </h2>
  );
}

function TagChip({ label, accent, muted }: { label: string; accent?: boolean; muted?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 3,
        border: accent ? `1px solid ${ACCENT}` : "1px solid transparent",
        background: accent ? "#FCEEE9" : "transparent",
        color: accent ? ACCENT : muted ? MUTED : INK,
      }}
    >
      {label}
    </span>
  );
}

function ChannelChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 3,
        border: `1px solid ${RULE}`,
        color: INK,
      }}
    >
      {label}
    </span>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        padding: "6px 10px",
        borderRadius: 3,
        border: `1px solid ${RULE}`,
        color: MUTED,
        background: CARD,
      }}
    >
      {label}
    </span>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${RULE}`, borderRadius: 4, background: CARD }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  color: MUTED,
                  fontWeight: 500,
                  background: "#F5EFE3",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "12px 16px", verticalAlign: "top", color: INK }}>{children}</td>;
}
