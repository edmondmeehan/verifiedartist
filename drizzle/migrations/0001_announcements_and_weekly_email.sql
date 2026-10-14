-- Announcement-day checks + weekly manager email.

-- update_verifications: tell routine updates apart from announcements
-- (new tour dates, new release, new ticket links). Announcements get a
-- "before" snapshot and an extra early check at ~6h.
ALTER TABLE public.update_verifications
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'update'
    CHECK (kind IN ('update', 'announcement')),
  ADD COLUMN IF NOT EXISTS baseline_result JSONB,
  ADD COLUMN IF NOT EXISTS changes JSONB;

-- Weekly refresh: when the scheduled job last audited each artist.
ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS last_auto_audit_at TIMESTAMPTZ;

-- Weekly email settings per organization.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS weekly_email_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekly_email_recipients TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_weekly_email_at TIMESTAMPTZ;
