import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

// Palette (matches app surface/primary tone; rendered on white page)
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.52);
const RULE = rgb(0.86, 0.87, 0.9);
const ACCENT = rgb(0.13, 0.55, 0.42); // verdict-verified-ish green

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

export interface ReportMeta {
  orgName: string;
  title: string;
  subtitle?: string;
  generatedAt?: Date;
}

interface Ctx {
  doc: PDFDocument;
  fonts: Fonts;
  meta: ReportMeta;
  page: PDFPage;
  y: number;
  pageIndex: number;
}

async function initCtx(meta: ReportMeta): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.orgName);
  doc.setCreator("Verified");
  doc.setProducer("Verified");
  doc.setCreationDate(meta.generatedAt ?? new Date());
  const [regular, bold, mono] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Courier),
  ]);
  const ctx: Ctx = {
    doc,
    fonts: { regular, bold, mono },
    meta,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN_TOP,
    pageIndex: 0,
  };
  drawHeader(ctx);
  return ctx;
}

function drawHeader(ctx: Ctx) {
  const { page, fonts, meta } = ctx;
  page.drawText(meta.orgName.toUpperCase(), {
    x: MARGIN_X, y: PAGE_H - 34,
    size: 8, font: fonts.mono, color: MUTED,
  });
  const dateStr = (meta.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const dateW = fonts.mono.widthOfTextAtSize(dateStr, 8);
  page.drawText(dateStr, {
    x: PAGE_W - MARGIN_X - dateW, y: PAGE_H - 34,
    size: 8, font: fonts.mono, color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: PAGE_H - 42 },
    end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 42 },
    thickness: 0.5, color: RULE,
  });
  ctx.y = PAGE_H - MARGIN_TOP;
}

function drawFooter(ctx: Ctx) {
  const { page, fonts, pageIndex } = ctx;
  const label = `Page ${pageIndex + 1}`;
  const w = fonts.mono.widthOfTextAtSize(label, 8);
  page.drawText(label, {
    x: PAGE_W - MARGIN_X - w, y: 28,
    size: 8, font: fonts.mono, color: MUTED,
  });
  page.drawText("Verified · confidential", {
    x: MARGIN_X, y: 28,
    size: 8, font: fonts.mono, color: MUTED,
  });
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed >= MARGIN_BOTTOM) return;
  drawFooter(ctx);
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageIndex += 1;
  drawHeader(ctx);
}

function sanitize(s: string): string {
  // WinAnsi-safe: replace smart quotes, em/en dashes, etc.
  return (s ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // Strip any remaining non-WinAnsi chars
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      // Handle single word longer than maxWidth
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let chunk = "";
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      } else line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---- Primitives -------------------------------------------------------------

export function title(ctx: Ctx, text: string, subtitle?: string) {
  ensureSpace(ctx, 60);
  ctx.page.drawText(sanitize(text), {
    x: MARGIN_X, y: ctx.y - 22,
    size: 22, font: ctx.fonts.bold, color: INK,
  });
  ctx.y -= 28;
  if (subtitle) {
    ctx.page.drawText(sanitize(subtitle), {
      x: MARGIN_X, y: ctx.y - 12,
      size: 10, font: ctx.fonts.regular, color: MUTED,
    });
    ctx.y -= 18;
  }
  ctx.y -= 10;
}

export function h2(ctx: Ctx, text: string) {
  ensureSpace(ctx, 30);
  ctx.y -= 6;
  ctx.page.drawText(sanitize(text).toUpperCase(), {
    x: MARGIN_X, y: ctx.y - 10,
    size: 9, font: ctx.fonts.mono, color: MUTED,
  });
  ctx.y -= 14;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y }, end: { x: PAGE_W - MARGIN_X, y: ctx.y },
    thickness: 0.5, color: RULE,
  });
  ctx.y -= 10;
}

export function paragraph(ctx: Ctx, text: string, size = 10) {
  const lines = wrap(text, ctx.fonts.regular, size, PAGE_W - MARGIN_X * 2);
  for (const line of lines) {
    ensureSpace(ctx, size + 4);
    ctx.page.drawText(line, {
      x: MARGIN_X, y: ctx.y - size,
      size, font: ctx.fonts.regular, color: INK,
    });
    ctx.y -= size + 4;
  }
  ctx.y -= 4;
}

export function keyValue(ctx: Ctx, pairs: Array<[string, string]>) {
  const colW = 130;
  const size = 10;
  for (const [k, v] of pairs) {
    const vLines = wrap(v || "-", ctx.fonts.regular, size, PAGE_W - MARGIN_X * 2 - colW - 8);
    const rowH = Math.max(vLines.length * (size + 3), size + 3);
    ensureSpace(ctx, rowH + 4);
    ctx.page.drawText(sanitize(k), {
      x: MARGIN_X, y: ctx.y - size,
      size, font: ctx.fonts.bold, color: INK,
    });
    let ly = ctx.y - size;
    for (const line of vLines) {
      ctx.page.drawText(line, {
        x: MARGIN_X + colW, y: ly,
        size, font: ctx.fonts.regular, color: INK,
      });
      ly -= size + 3;
    }
    ctx.y -= rowH + 4;
  }
}

export function badge(ctx: Ctx, x: number, y: number, label: string, tone: "ok" | "warn" | "muted" = "muted") {
  const size = 8;
  const w = ctx.fonts.mono.widthOfTextAtSize(label, size) + 10;
  const bg = tone === "ok" ? rgb(0.9, 0.97, 0.94) : tone === "warn" ? rgb(1, 0.95, 0.87) : rgb(0.94, 0.94, 0.96);
  const fg = tone === "ok" ? ACCENT : tone === "warn" ? rgb(0.78, 0.51, 0.05) : MUTED;
  ctx.page.drawRectangle({ x, y: y - 2, width: w, height: size + 6, color: bg, borderColor: bg });
  ctx.page.drawText(label, { x: x + 5, y: y, size, font: ctx.fonts.mono, color: fg });
  return w;
}

export function table(ctx: Ctx, columns: Array<{ label: string; width: number }>, rows: string[][]) {
  const size = 9;
  const rowPad = 6;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const startX = MARGIN_X;

  // Header
  ensureSpace(ctx, size + rowPad * 2);
  let x = startX;
  ctx.page.drawRectangle({
    x: startX, y: ctx.y - (size + rowPad), width: totalW, height: size + rowPad,
    color: rgb(0.97, 0.97, 0.98),
  });
  for (const c of columns) {
    ctx.page.drawText(sanitize(c.label).toUpperCase(), {
      x: x + 6, y: ctx.y - size - 2,
      size: 8, font: ctx.fonts.mono, color: MUTED,
    });
    x += c.width;
  }
  ctx.y -= size + rowPad;

  // Rows
  for (const row of rows) {
    const cellLines = row.map((cell, i) =>
      wrap(cell ?? "", ctx.fonts.regular, size, columns[i].width - 12),
    );
    const rowH = Math.max(...cellLines.map((ls) => ls.length)) * (size + 2) + rowPad;
    ensureSpace(ctx, rowH);
    x = startX;
    ctx.page.drawLine({
      start: { x: startX, y: ctx.y }, end: { x: startX + totalW, y: ctx.y },
      thickness: 0.3, color: RULE,
    });
    for (let i = 0; i < columns.length; i++) {
      let ly = ctx.y - size - 2;
      for (const line of cellLines[i]) {
        ctx.page.drawText(line, {
          x: x + 6, y: ly, size, font: ctx.fonts.regular, color: INK,
        });
        ly -= size + 2;
      }
      x += columns[i].width;
    }
    ctx.y -= rowH;
  }
  ctx.y -= 6;
}

async function finish(ctx: Ctx): Promise<Uint8Array> {
  drawFooter(ctx);
  return ctx.doc.save();
}

// ---- Renderers --------------------------------------------------------------

export interface ArtistReportInput {
  meta: ReportMeta;
  artist: {
    name: string;
    status: string;
    officialSiteUrl?: string | null;
    spotifyId?: string | null;
    spotifySyncedAt?: string | null;
    spotifySnapshot?: any;
    canonical?: any;
  };
  latestAudit?: {
    runAt: string;
    verdictCounts: Record<string, number>;
    findings: Array<{ query: string; agent: string; verdict: string; response: string }>;
  } | null;
}

export async function renderArtistReport(input: ArtistReportInput): Promise<Uint8Array> {
  const ctx = await initCtx(input.meta);
  const a = input.artist;
  title(ctx, a.name, `Artist report · status: ${a.status}`);

  h2(ctx, "Overview");
  const snap = a.spotifySnapshot ?? {};
  keyValue(ctx, [
    ["Official site", a.officialSiteUrl ?? "-"],
    ["Spotify ID", a.spotifyId ?? "-"],
    ["Followers", snap.followers != null ? Number(snap.followers).toLocaleString() : "-"],
    ["Popularity", snap.popularity != null ? String(snap.popularity) : "-"],
    ["Genres", Array.isArray(snap.genres) ? snap.genres.join(", ") : "-"],
    ["Last Spotify sync", a.spotifySyncedAt ? new Date(a.spotifySyncedAt).toISOString().slice(0, 19).replace("T", " ") : "never"],
  ]);

  if (snap.latest_release) {
    h2(ctx, "Latest release");
    keyValue(ctx, [
      ["Title", snap.latest_release.title ?? snap.latest_release.name ?? "-"],
      ["Release date", snap.latest_release.date ?? snap.latest_release.release_date ?? "-"],
      ["Type", snap.latest_release.type ?? "-"],
    ]);
  }

  const canonical = a.canonical ?? {};
  if (canonical.bio?.short || canonical.bio?.long) {
    h2(ctx, "Biography");
    if (canonical.bio.short) paragraph(ctx, canonical.bio.short);
    if (canonical.bio.long && canonical.bio.long !== canonical.bio.short) paragraph(ctx, canonical.bio.long);
  }

  if (Array.isArray(canonical.tour_dates) && canonical.tour_dates.length) {
    h2(ctx, "Upcoming tour dates");
    table(
      ctx,
      [
        { label: "Date", width: 80 },
        { label: "Venue", width: 160 },
        { label: "City", width: 130 },
        { label: "Status", width: 129 },
      ],
      canonical.tour_dates.slice(0, 25).map((d: any) => [
        d.date ?? "-",
        d.venue ?? "-",
        [d.city, d.country].filter(Boolean).join(", ") || "-",
        d.status ?? "-",
      ]),
    );
  }

  if (input.latestAudit) {
    h2(ctx, "Latest audit");
    paragraph(
      ctx,
      `Run at ${new Date(input.latestAudit.runAt).toISOString().slice(0, 19).replace("T", " ")}`,
      9,
    );
    const vc = input.latestAudit.verdictCounts;
    const badges: string[] = Object.entries(vc).map(([k, v]) => `${k}: ${v}`);
    if (badges.length) {
      ensureSpaceExport(ctx, 20);
      let x = MARGIN_X;
      for (const b of badges) {
        const w = badge(ctx, x, ctx.y - 8, b, b.startsWith("verified") ? "ok" : b.startsWith("stale") || b.startsWith("conflict") ? "warn" : "muted");
        x += w + 6;
      }
      ctx.y -= 20;
    }
    table(
      ctx,
      [
        { label: "Query", width: 220 },
        { label: "Agent", width: 80 },
        { label: "Verdict", width: 70 },
        { label: "Excerpt", width: 129 },
      ],
      input.latestAudit.findings.slice(0, 20).map((f) => [
        f.query,
        f.agent,
        f.verdict,
        (f.response ?? "").slice(0, 140),
      ]),
    );
  }

  return finish(ctx);
}

// Export ensureSpace as a helper for renderers below
export function ensureSpaceExport(ctx: Ctx, needed: number) {
  ensureSpace(ctx, needed);
}

export interface AuditReportInput {
  meta: ReportMeta;
  run: {
    artistName: string;
    runAt: string;
    verdictCounts: Record<string, number>;
    findings: Array<{ query: string; category: string; agent: string; verdict: string; response: string; staleness: number | null }>;
  };
}

export async function renderAuditReport(input: AuditReportInput): Promise<Uint8Array> {
  const ctx = await initCtx(input.meta);
  const r = input.run;
  title(ctx, `Audit · ${r.artistName}`, `Run at ${new Date(r.runAt).toISOString().slice(0, 19).replace("T", " ")}`);

  h2(ctx, "Summary");
  ensureSpace(ctx, 20);
  let x = MARGIN_X;
  for (const [verdict, count] of Object.entries(r.verdictCounts)) {
    const tone = verdict === "verified" ? "ok" : verdict === "stale" || verdict === "conflict" ? "warn" : "muted";
    const w = badge(ctx, x, ctx.y - 8, `${verdict}: ${count}`, tone);
    x += w + 6;
  }
  ctx.y -= 24;

  h2(ctx, "Findings");
  table(
    ctx,
    [
      { label: "Query", width: 200 },
      { label: "Cat.", width: 55 },
      { label: "Agent", width: 65 },
      { label: "Verdict", width: 60 },
      { label: "Stale", width: 40 },
      { label: "Excerpt", width: 79 },
    ],
    r.findings.map((f) => [
      f.query,
      f.category,
      f.agent,
      f.verdict,
      f.staleness != null ? `${f.staleness}d` : "-",
      (f.response ?? "").slice(0, 100),
    ]),
  );

  return finish(ctx);
}

export interface RosterReportInput {
  meta: ReportMeta;
  artists: Array<{
    name: string;
    status: string;
    followers: number | null;
    popularity: number | null;
    genres: string[];
    spotifySyncedAt: string | null;
  }>;
}

export async function renderRosterReport(input: RosterReportInput): Promise<Uint8Array> {
  const ctx = await initCtx(input.meta);
  title(ctx, "Roster summary", `${input.artists.length} artists`);

  h2(ctx, "Artists");
  table(
    ctx,
    [
      { label: "Artist", width: 160 },
      { label: "Status", width: 60 },
      { label: "Followers", width: 70 },
      { label: "Pop.", width: 40 },
      { label: "Genres", width: 130 },
      { label: "Synced", width: 39 },
    ],
    input.artists.map((a) => {
      const staleDays = a.spotifySyncedAt
        ? Math.floor((Date.now() - new Date(a.spotifySyncedAt).getTime()) / 86400000)
        : null;
      return [
        a.name,
        a.status,
        a.followers != null ? Number(a.followers).toLocaleString() : "-",
        a.popularity != null ? String(a.popularity) : "-",
        a.genres.slice(0, 3).join(", "),
        staleDays == null ? "never" : `${staleDays}d`,
      ];
    }),
  );

  return finish(ctx);
}

export interface CustomReportInput {
  meta: ReportMeta;
  sections: Array<{ heading?: string; body: string }>;
}

export async function renderCustomReport(input: CustomReportInput): Promise<Uint8Array> {
  const ctx = await initCtx(input.meta);
  title(ctx, input.meta.title, input.meta.subtitle);
  for (const s of input.sections) {
    if (s.heading) h2(ctx, s.heading);
    // Preserve blank-line paragraph breaks
    const paras = s.body.split(/\n\s*\n/);
    for (const p of paras) paragraph(ctx, p.replace(/\n/g, " "));
  }
  return finish(ctx);
}
