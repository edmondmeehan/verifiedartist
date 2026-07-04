ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS spotify_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS spotify_snapshot JSONB;