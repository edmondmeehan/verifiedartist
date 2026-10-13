# Artist Echo

Lovable Build Prompt — Artist AI Presence Platform (working name: "Verified")

Paste everything below the line into Lovable as your first prompt. It's scoped to the sellable wedge (monitoring + distribution dashboard), not the full fan-out infrastructure — that comes in Phase 2 prompts at the end.

PROMPT START

Build a B2B SaaS web app called Verified — a platform where artist managers and labels monitor and control what AI assistants (ChatGPT, Claude, Gemini, Perplexity, Grok) say about their artists, and distribute updates to the sources those AIs retrieve from.

Core concept

AI assistants answer fan questions ("when is Matchbox Twenty playing next?", "what's their latest album?") by retrieving from web sources — artist websites, Bandsintown, Wikipedia, Spotify, Google's Knowledge Graph. This platform (1) audits what each AI currently says about an artist, (2) flags stale or wrong answers, and (3) manages a single canonical artist record that fans out to every retrieval source, with a 48-hour freshness SLA and an audit trail proving it.

Users & roles

Manager (per-artist plan): manages 1–5 artists

Label/Enterprise: manages a roster (unlimited artists), team seats

Admin (internal): sees all accounts

Auth via Supabase (email + Google OAuth). Multi-tenant: every record scoped to an organization.

Data model (Supabase)

organizations — name, plan (per_artist | enterprise), seats

artists — org_id, name, official_site_url, spotify_id, bandsintown_id, wikidata_qid, youtube_channel_id, x_handle, status

canonical_records — artist_id, versioned JSON blob containing: bio (short/long), members, hometown, genres, latest_release {title, date, links}, tour_dates [{date, venue, city, country, ticket_url, status}], videos [{title, url, date}], socials, press_contact. One current version + history.

audit_queries — artist_id, query_text (e.g. "When is {artist} touring next?"), category (tour | release | bio | tickets | general)

audit_runs — artist_id, run_at, agent (chatgpt | claude | gemini | perplexity | grok), query_id, response_text, verdict (accurate | stale | wrong | missing), staleness_days, diff_from_canonical

distribution_targets — artist_id, target (artist_site | bandsintown | songkick | wikidata | google_sitemap | indexnow | spotify | x), status (connected | pending | manual), last_pushed_at

distribution_log — artist_id, target, payload_summary, pushed_at, propagation_confirmed_at, sla_met (boolean)

Pages

Dashboard (org home) — roster grid: each artist card shows an AI Accuracy Score (0–100, computed from latest audit run verdicts), last audit time, # of flagged answers, SLA status. Sort by worst score first.

Artist detail — three tabs:

AI Report Card: table of the 5 agents × latest audit queries, showing each agent's answer snippet, verdict badge (green accurate / yellow stale / red wrong / gray missing), and days-stale. Expandable rows show full response + diff against canonical record.

Canonical Record: editable form for the full artist record (bio, tour dates as a sortable table with add/edit/delete rows, releases, videos, links). Saving creates a new version and shows a "Distribute changes" CTA.

Distribution: grid of targets with connection status, last push time, propagation time, and per-target SLA history (sparkline of hours-to-propagate). Manual targets (Wikidata) show a task checklist instead.

Audit history — timeline of runs with score trend chart per artist.

SLA Report — exportable monthly report per artist: % of updates propagated <48h, before/after AI answer screenshots (text), score trend. This is the renewal artifact.

Settings — org, team, plan, API keys for connected services.

The audit engine (the real functionality — build this to actually work)

Use the Anthropic API (already available in Lovable via Claude integration or a Supabase edge function) to run audits:

For each artist, run each audit_query against Claude with web search enabled, and record the response.

Then run a second Claude call that compares the response against the artist's canonical_record and returns JSON only: {verdict, staleness_days, discrepancies: [...]}.

Store both in audit_runs.

For ChatGPT/Gemini/Perplexity/Grok in the MVP: create the schema and UI now, and stub these agents with a "manual paste" mode — a form where the user pastes that agent's answer and the same Claude comparison call scores it. (Direct API access to competitors' search-enabled endpoints comes later; do not fake their responses.)

Scheduled daily audits via a Supabase cron edge function; also a "Run audit now" button.

Design

Dark, authoritative, data-forward — think Linear meets a broadcast newsroom. Near-black background (#0A0A0B), one signal color for accuracy states plus an electric accent (#E8FF3C) for CTAs and score highlights. Typography: Archivo Black or similar heavy grotesque for headers, Inter for data. Verdict badges are the visual language of the whole product — make them crisp. Score displayed as a large numeric with trend arrow. No gradients, no glassmorphism. Dense tables done well.

Explicitly out of scope for this build

Real Bandsintown/Songkick/Wikidata write APIs (UI + log tables only, marked "pending connection")

Payments (plan field only)

MCP server (Phase 3)

Build the full schema, auth, all five pages, and the working Claude-powered audit engine first.

PROMPT END

Phase 2 prompts (send after MVP works)

"Add the fan-out engine" — Supabase edge functions for: Bandsintown for Artists API push (tour dates), IndexNow ping on canonical record save, Google sitemap ping, X post composer with pre-filled tour announcement. Each push writes to distribution_log and starts an SLA timer; a follow-up cron re-runs the relevant audit query 24h and 48h later to set propagation_confirmed_at.

"Add the artist site widget" — generate an embeddable JSON-LD <script> block (MusicGroup + MusicEvent array) from the canonical record, with copy-paste instructions and a hosted endpoint (/api/artists/{id}/jsonld) the artist's site can pull dynamically so tour edits propagate with zero touch.

"Add multi-agent audits" — wire OpenAI + Gemini + Perplexity APIs (search-enabled endpoints) into the audit engine behind a per-agent adapter interface, replacing manual paste mode.

Phase 3 (separate project, not Lovable)

The MCP server — a verified artist-data connector agents can query directly. That's a Node/TypeScript service against the same Supabase canonical records. Different prompt, different day.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://verifiedartist.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/855fe32e-91d7-48d8-8255-61df83eeaa49).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
