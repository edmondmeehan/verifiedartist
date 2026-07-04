-- 1. Create table
CREATE TABLE public.artist_public_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  artist_id UUID NOT NULL UNIQUE REFERENCES public.artists(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  published BOOLEAN NOT NULL DEFAULT false,
  headline TEXT,
  intro_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_here JSONB NOT NULL DEFAULT '[]'::jsonb,
  live_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  official_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  faq JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT artist_public_pages_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 80)
);

-- 2. Grants
GRANT SELECT ON public.artist_public_pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artist_public_pages TO authenticated;
GRANT ALL ON public.artist_public_pages TO service_role;

-- 3. Enable RLS
ALTER TABLE public.artist_public_pages ENABLE ROW LEVEL SECURITY;

-- 4. Policies
CREATE POLICY "Anyone can view published artist pages"
  ON public.artist_public_pages
  FOR SELECT
  TO anon
  USING (published = true);

CREATE POLICY "Members can view their org artist pages"
  ON public.artist_public_pages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      JOIN public.organization_members m ON m.org_id = a.org_id
      WHERE a.id = artist_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can create their org artist pages"
  ON public.artist_public_pages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artists a
      JOIN public.organization_members m ON m.org_id = a.org_id
      WHERE a.id = artist_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can update their org artist pages"
  ON public.artist_public_pages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      JOIN public.organization_members m ON m.org_id = a.org_id
      WHERE a.id = artist_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artists a
      JOIN public.organization_members m ON m.org_id = a.org_id
      WHERE a.id = artist_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can delete their org artist pages"
  ON public.artist_public_pages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artists a
      JOIN public.organization_members m ON m.org_id = a.org_id
      WHERE a.id = artist_id AND m.user_id = auth.uid()
    )
  );

-- 5. Updated_at trigger (function already exists in project)
CREATE TRIGGER trg_artist_public_pages_updated_at
  BEFORE UPDATE ON public.artist_public_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Index for public lookups
CREATE INDEX idx_artist_public_pages_slug_published
  ON public.artist_public_pages(slug) WHERE published = true;