
-- Roles enum
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.plan_type AS ENUM ('per_artist', 'enterprise');
CREATE TYPE public.artist_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE public.audit_agent AS ENUM ('chatgpt', 'claude', 'gemini', 'perplexity', 'grok');
CREATE TYPE public.audit_verdict AS ENUM ('accurate', 'stale', 'wrong', 'missing', 'pending');
CREATE TYPE public.audit_category AS ENUM ('tour', 'release', 'bio', 'tickets', 'general');
CREATE TYPE public.dist_target AS ENUM ('artist_site', 'bandsintown', 'songkick', 'wikidata', 'google_sitemap', 'indexnow', 'spotify', 'x');
CREATE TYPE public.dist_status AS ENUM ('connected', 'pending', 'manual', 'error');

-- Updated_at trigger fn
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Organizations
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan public.plan_type NOT NULL DEFAULT 'per_artist',
  seats INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Membership
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(org_id);

-- Helper: is user member of org (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = _org_id AND user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_org_id UUID, _user_id UUID)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.organization_members WHERE org_id = _org_id AND user_id = _user_id;
$$;

-- Orgs policies
CREATE POLICY "members view org" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id, auth.uid()));
CREATE POLICY "owners update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.org_role_of(id, auth.uid()) IN ('owner','admin'));
CREATE POLICY "any auth create org" ON public.organizations FOR INSERT TO authenticated WITH CHECK (true);

-- Members policies
CREATE POLICY "view own memberships" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id, auth.uid()));
CREATE POLICY "admins manage members" ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (public.org_role_of(org_id, auth.uid()) IN ('owner','admin') OR user_id = auth.uid());
CREATE POLICY "admins update members" ON public.organization_members FOR UPDATE TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));
CREATE POLICY "admins delete members" ON public.organization_members FOR DELETE TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin') OR user_id = auth.uid());

-- Artists
CREATE TABLE public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  official_site_url TEXT,
  spotify_id TEXT,
  bandsintown_id TEXT,
  wikidata_qid TEXT,
  youtube_channel_id TEXT,
  x_handle TEXT,
  status public.artist_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artists TO authenticated;
GRANT ALL ON public.artists TO service_role;
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_artists_org ON public.artists(org_id);
CREATE TRIGGER trg_artists_updated BEFORE UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "members view artists" ON public.artists FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "members insert artists" ON public.artists FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "members update artists" ON public.artists FOR UPDATE TO authenticated USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "admins delete artists" ON public.artists FOR DELETE TO authenticated USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));

-- Canonical records (versioned)
CREATE TABLE public.canonical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_records TO authenticated;
GRANT ALL ON public.canonical_records TO service_role;
ALTER TABLE public.canonical_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_canon_artist ON public.canonical_records(artist_id);
CREATE INDEX idx_canon_current ON public.canonical_records(artist_id) WHERE is_current;

CREATE POLICY "members view canon" ON public.canonical_records FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members insert canon" ON public.canonical_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members update canon" ON public.canonical_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

-- Audit queries
CREATE TABLE public.audit_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  category public.audit_category NOT NULL DEFAULT 'general',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_queries TO authenticated;
GRANT ALL ON public.audit_queries TO service_role;
ALTER TABLE public.audit_queries ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_aq_artist ON public.audit_queries(artist_id);

CREATE POLICY "members view aq" ON public.audit_queries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members write aq" ON public.audit_queries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

-- Audit runs
CREATE TABLE public.audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  query_id UUID REFERENCES public.audit_queries(id) ON DELETE SET NULL,
  agent public.audit_agent NOT NULL,
  response_text TEXT,
  verdict public.audit_verdict NOT NULL DEFAULT 'pending',
  staleness_days INTEGER,
  discrepancies JSONB,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_runs TO authenticated;
GRANT ALL ON public.audit_runs TO service_role;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ar_artist ON public.audit_runs(artist_id, run_at DESC);
CREATE INDEX idx_ar_agent ON public.audit_runs(artist_id, agent, run_at DESC);

CREATE POLICY "members view ar" ON public.audit_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members insert ar" ON public.audit_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

-- Distribution targets
CREATE TABLE public.distribution_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  target public.dist_target NOT NULL,
  status public.dist_status NOT NULL DEFAULT 'pending',
  last_pushed_at TIMESTAMPTZ,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id, target)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_targets TO authenticated;
GRANT ALL ON public.distribution_targets TO service_role;
ALTER TABLE public.distribution_targets ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_dt_artist ON public.distribution_targets(artist_id);
CREATE TRIGGER trg_dt_updated BEFORE UPDATE ON public.distribution_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "members view dt" ON public.distribution_targets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members write dt" ON public.distribution_targets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

-- Distribution log
CREATE TABLE public.distribution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  target public.dist_target NOT NULL,
  payload_summary TEXT,
  pushed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  propagation_confirmed_at TIMESTAMPTZ,
  sla_met BOOLEAN
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_log TO authenticated;
GRANT ALL ON public.distribution_log TO service_role;
ALTER TABLE public.distribution_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_dl_artist ON public.distribution_log(artist_id, pushed_at DESC);

CREATE POLICY "members view dl" ON public.distribution_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members insert dl" ON public.distribution_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

-- On new user: create a personal org and add as owner
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id UUID;
  display_name TEXT;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'My Organization');
  INSERT INTO public.organizations (name, plan) VALUES (display_name || '''s Workspace', 'per_artist') RETURNING id INTO new_org_id;
  INSERT INTO public.organization_members (org_id, user_id, role) VALUES (new_org_id, NEW.id, 'owner');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
