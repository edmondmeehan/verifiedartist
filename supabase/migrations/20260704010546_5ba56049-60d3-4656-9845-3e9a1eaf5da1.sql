
-- Platform-wide staff roles (distinct from per-organization roles)
DO $$ BEGIN
  CREATE TYPE public.platform_role AS ENUM ('super_admin', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.platform_user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.platform_user_roles TO authenticated;
GRANT ALL ON public.platform_user_roles TO service_role;

ALTER TABLE public.platform_user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_platform_role(_user_id UUID, _role public.platform_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_platform_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_user_roles
    WHERE user_id = _user_id
  )
$$;

CREATE POLICY "Staff can view platform roles"
ON public.platform_user_roles FOR SELECT
TO authenticated
USING (public.is_platform_staff(auth.uid()));

CREATE POLICY "Super admins can manage platform roles"
ON public.platform_user_roles FOR ALL
TO authenticated
USING (public.has_platform_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
