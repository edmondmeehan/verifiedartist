
ALTER TABLE public.org_connections
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_details JSONB;

-- Relax NOT NULL on api_key so platform-managed rows (spotify/indexnow) can be tracked
-- without an org-supplied key.
ALTER TABLE public.org_connections ALTER COLUMN api_key DROP NOT NULL;
