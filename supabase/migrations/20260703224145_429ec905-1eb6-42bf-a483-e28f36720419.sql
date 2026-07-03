
-- Fix overly-permissive INSERT policy on orgs
DROP POLICY IF EXISTS "any auth create org" ON public.organizations;
CREATE POLICY "auth users create org" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Lock down SECURITY DEFINER helpers to authenticated only
REVOKE ALL ON FUNCTION public.is_org_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_role_of(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role_of(UUID, UUID) TO authenticated;
