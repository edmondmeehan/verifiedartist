
-- Add editor/viewer to org_role enum
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'editor';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'viewer';

-- ============ org_invites ============
CREATE TABLE public.org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.org_role NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX org_invites_email_idx ON public.org_invites (lower(email)) WHERE accepted_at IS NULL;
CREATE INDEX org_invites_org_idx ON public.org_invites (org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_invites TO authenticated;
GRANT ALL ON public.org_invites TO service_role;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can view invites for their org
CREATE POLICY "Org admins view invites" ON public.org_invites FOR SELECT TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));
CREATE POLICY "Org admins create invites" ON public.org_invites FOR INSERT TO authenticated
  WITH CHECK (public.org_role_of(org_id, auth.uid()) IN ('owner','admin') AND invited_by = auth.uid());
CREATE POLICY "Org admins update invites" ON public.org_invites FOR UPDATE TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));
CREATE POLICY "Org admins delete invites" ON public.org_invites FOR DELETE TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));

-- ============ org_connections ============
CREATE TABLE public.org_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_connections TO authenticated;
GRANT ALL ON public.org_connections TO service_role;
ALTER TABLE public.org_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage connections" ON public.org_connections FOR ALL TO authenticated
  USING (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'))
  WITH CHECK (public.org_role_of(org_id, auth.uid()) IN ('owner','admin'));

CREATE TRIGGER trg_org_connections_updated
  BEFORE UPDATE ON public.org_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Auto-accept pending invites on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id UUID;
  display_name TEXT;
  invite_count INT;
BEGIN
  -- Auto-accept any pending invites matching this email
  SELECT count(*) INTO invite_count
  FROM public.org_invites
  WHERE lower(email) = lower(NEW.email)
    AND accepted_at IS NULL
    AND expires_at > now();

  IF invite_count > 0 THEN
    INSERT INTO public.organization_members (org_id, user_id, role)
    SELECT org_id, NEW.id, role
    FROM public.org_invites
    WHERE lower(email) = lower(NEW.email)
      AND accepted_at IS NULL
      AND expires_at > now()
    ON CONFLICT (org_id, user_id) DO NOTHING;

    UPDATE public.org_invites
    SET accepted_at = now(), accepted_by = NEW.id
    WHERE lower(email) = lower(NEW.email)
      AND accepted_at IS NULL
      AND expires_at > now();
  END IF;

  -- Also create a personal workspace so the user always has one
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'My Organization');
  INSERT INTO public.organizations (name, plan) VALUES (display_name || '''s Workspace', 'per_artist') RETURNING id INTO new_org_id;
  INSERT INTO public.organization_members (org_id, user_id, role) VALUES (new_org_id, NEW.id, 'owner');
  RETURN NEW;
END;
$function$;
