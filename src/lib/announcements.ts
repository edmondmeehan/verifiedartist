// Detect "announcement" changes between two canonical record versions:
// new tour dates, a new release, or new/changed ticket links. These are the
// moments AI answers are most likely to be wrong and matter most.

type TourDate = { date?: string; venue?: string; city?: string; country?: string; ticket_url?: string; status?: string };
type Canonical = {
  tour_dates?: TourDate[];
  latest_release?: { title?: string; date?: string };
};

export interface AnnouncementDiff {
  isAnnouncement: boolean;
  addedDates: TourDate[];
  removedDates: TourDate[];
  ticketLinkChanges: TourDate[];
  newRelease: { title: string; date: string } | null;
  summary: string;
}

const key = (d: TourDate) => `${(d.date ?? "").trim()}|${(d.venue ?? "").trim().toLowerCase()}`;

export function diffCanonical(prevRaw: unknown, nextRaw: unknown): AnnouncementDiff {
  const prev = (prevRaw ?? {}) as Canonical;
  const next = (nextRaw ?? {}) as Canonical;
  const prevDates = new Map((prev.tour_dates ?? []).filter((d) => d?.date).map((d) => [key(d), d]));
  const nextDates = new Map((next.tour_dates ?? []).filter((d) => d?.date).map((d) => [key(d), d]));

  const addedDates = [...nextDates.entries()].filter(([k]) => !prevDates.has(k)).map(([, d]) => d);
  const removedDates = [...prevDates.entries()].filter(([k]) => !nextDates.has(k)).map(([, d]) => d);
  const ticketLinkChanges = [...nextDates.entries()]
    .filter(([k, d]) => prevDates.has(k) && (prevDates.get(k)!.ticket_url ?? "") !== (d.ticket_url ?? "") && !!d.ticket_url)
    .map(([, d]) => d);

  const pTitle = (prev.latest_release?.title ?? "").trim();
  const nTitle = (next.latest_release?.title ?? "").trim();
  const newRelease = nTitle && nTitle.toLowerCase() !== pTitle.toLowerCase()
    ? { title: nTitle, date: next.latest_release?.date ?? "" }
    : null;

  const parts: string[] = [];
  if (addedDates.length) parts.push(`${addedDates.length} new date${addedDates.length === 1 ? "" : "s"}`);
  if (removedDates.length) parts.push(`${removedDates.length} date${removedDates.length === 1 ? "" : "s"} removed`);
  if (ticketLinkChanges.length) parts.push(`${ticketLinkChanges.length} ticket link${ticketLinkChanges.length === 1 ? "" : "s"} changed`);
  if (newRelease) parts.push(`new release “${newRelease.title}”`);

  return {
    isAnnouncement: parts.length > 0,
    addedDates,
    removedDates,
    ticketLinkChanges,
    newRelease,
    summary: parts.join(", "),
  };
}

/** Fan questions to add for an announcement, so the audit asks what fans will ask. */
export function announcementQuestions(artistName: string, diff: AnnouncementDiff): Array<{ text: string; category: "tour" | "tickets" | "release" }> {
  const out: Array<{ text: string; category: "tour" | "tickets" | "release" }> = [];
  const cities = [...new Set(diff.addedDates.map((d) => (d.city ?? "").trim()).filter(Boolean))].slice(0, 3);
  for (const city of cities) {
    out.push({ text: `When is ${artistName} playing in ${city}?`, category: "tour" });
  }
  if (cities[0]) out.push({ text: `Where can I buy tickets to see ${artistName} in ${cities[0]}?`, category: "tickets" });
  if (diff.newRelease) {
    out.push({ text: `When does ${artistName}'s ${diff.newRelease.title} come out?`, category: "release" });
  }
  return out;
}
