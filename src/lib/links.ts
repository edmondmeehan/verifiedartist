// Classify the links an AI assistant gives a fan, so we can show where AI is
// actually sending people to buy tickets. Shared by server (audit engine) and
// client (report card).

export type LinkKind = "official" | "primary" | "resale" | "info" | "other";

export interface ClassifiedLink {
  url: string;
  domain: string;
  kind: LinkKind;
  title?: string;
}

// Primary ticketing platforms — where face-value tickets are sold.
const PRIMARY = [
  "ticketmaster.", "livenation.", "axs.com", "eventbrite.", "dice.fm", "seetickets.",
  "etix.com", "ticketweb.", "frontgatetickets.com", "tixr.com", "eventim.", "ticketek.",
  "universe.com", "showclix.com", "prekindle.com", "ticketfly.",
  "ontour.vip", "please.co",
  // SeatGeek is the primary seller for some venues and a resale market for others.
  "seatgeek.",
];

// Secondary / resale marketplaces — usually above face value, not the artist's sale.
const RESALE = [
  "stubhub.", "vividseats.", "viagogo.", "tickpick.", "gametime.co",
  "ticketnetwork.", "scorebig.", "ticketsnow.", "ticketcity.", "megaseats.", "rexseats.",
  "ticketliquidator.", "boxofficeticketsales.", "onlineseats.", "ticketsmarter.",
  "goldstar.", "coastaltickets.", "tixbag.", "ticketclub.",
];

// Information sources — not a place to buy, but where AI got its facts.
const INFO = [
  "wikipedia.org", "wikidata.org", "bandsintown.com", "songkick.com", "spotify.com",
  "apple.com", "youtube.com", "instagram.com", "facebook.com", "x.com", "twitter.com",
  "tiktok.com", "allmusic.com", "setlist.fm", "billboard.com", "rollingstone.com",
  "pollstar.com", "jambase.com", "genius.com", "last.fm", "discogs.com", "reddit.com",
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matches(target: string, patterns: string[]): boolean {
  return patterns.some((p) => target.includes(p));
}

/**
 * @param officialDomains domains the artist controls or has authorised
 *   (official site, ticket_url domains from the canonical record, hosted page).
 */
export function classifyLink(url: string, officialDomains: string[], title?: string): ClassifiedLink {
  // Gemini grounding returns redirect URLs whose title is the real domain.
  let domain = domainOf(url);
  if (domain.includes("vertexaisearch.cloud.google.com") && title) {
    domain = title.replace(/^www\./, "").toLowerCase();
  }
  const full = `${domain}${(() => { try { return new URL(url).pathname; } catch { return ""; } })()}`;
  let kind: LinkKind = "other";
  if (officialDomains.some((d) => d && (domain === d || domain.endsWith(`.${d}`)))) kind = "official";
  else if (matches(full, RESALE)) kind = "resale";
  else if (matches(full, PRIMARY)) kind = "primary";
  else if (matches(full, INFO)) kind = "info";
  return { url, domain, kind, ...(title ? { title } : {}) };
}

const URL_RE = /https?:\/\/[^\s<>()"'\]\[]+/gi;

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return found.map((u) => u.replace(/[.,;:!?*)]+$/, ""));
}

export function officialDomainsFrom(opts: {
  officialSiteUrl?: string | null;
  canonical?: unknown;
  extra?: string[];
}): string[] {
  const out = new Set<string>();
  if (opts.officialSiteUrl) out.add(domainOf(opts.officialSiteUrl));
  const c = (opts.canonical ?? {}) as { tour_dates?: Array<{ ticket_url?: string }>; socials?: Record<string, string> };
  for (const d of c.tour_dates ?? []) if (d?.ticket_url) out.add(domainOf(d.ticket_url));
  for (const e of opts.extra ?? []) out.add(e);
  out.delete("");
  // A ticket_url on a resale site must never make that resale site "official".
  return [...out].filter((d) => !matches(d, RESALE));
}

export function dedupeLinks(links: ClassifiedLink[]): ClassifiedLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const k = l.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const LINK_KIND_META: Record<LinkKind, { label: string; className: string }> = {
  official: { label: "Official", className: "text-verdict-accurate border-verdict-accurate/40 bg-verdict-accurate/10" },
  primary: { label: "Primary ticketing", className: "text-verdict-accurate border-verdict-accurate/30 bg-verdict-accurate/5" },
  resale: { label: "Resale", className: "text-verdict-wrong border-verdict-wrong/40 bg-verdict-wrong/10" },
  info: { label: "Info", className: "text-muted-foreground border-border bg-surface" },
  other: { label: "Other", className: "text-verdict-stale border-verdict-stale/40 bg-verdict-stale/10" },
};
