-- Replace simulated propagation with real, evidence-based verification.
--
-- 1. distribution_log now records HOW an update was delivered:
--      delivery_status: 'delivered'   – we pushed it ourselves and the target accepted it
--                       'manual_task' – needs a human action on that platform (no write API)
--                       'done_manual' – a human marked the manual task as done
--                       'failed'      – push attempted and rejected
--    propagation_confirmed_at / sla_met are now ONLY set by a re-audit that shows
--    the AI answers actually changed (see update_verifications).
-- 2. update_verifications: one row per canonical version that was distributed.
--    The verification cron re-asks the AI assistants at ~24h and ~48h and only
--    marks it 'verified' when every automated agent answers accurately.
-- 3. audit_runs.links: every URL an assistant gave the fan, classified
--    (official / primary / resale / info / other) so we can show where AI sends fans for tickets.

ALTER TABLE public.distribution_log
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'manual_task'
    CHECK (delivery_status IN ('delivered', 'manual_task', 'done_manual', 'failed')),
  ADD COLUMN IF NOT EXISTS delivery_detail TEXT,
  ADD COLUMN IF NOT EXISTS verification_id UUID;

-- Old rows were "confirmed" by a timer, not by evidence. Clear those claims.
UPDATE public.distribution_log
   SET propagation_confirmed_at = NULL,
       sla_met = NULL,
       delivery_detail = COALESCE(delivery_detail, 'Legacy entry – logged before real delivery tracking existed.')
 WHERE verification_id IS NULL;

CREATE POLICY "members update dl" ON public.distribution_log FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

CREATE TABLE IF NOT EXISTS public.update_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  canonical_version INTEGER NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  checks_done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'missed', 'superseded')),
  verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_result JSONB
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.update_verifications TO authenticated;
GRANT ALL ON public.update_verifications TO service_role;
ALTER TABLE public.update_verifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_uv_artist ON public.update_verifications(artist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uv_due ON public.update_verifications(status, next_check_at);

CREATE POLICY "members view uv" ON public.update_verifications FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));
CREATE POLICY "members write uv" ON public.update_verifications FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.artists a WHERE a.id = artist_id AND public.is_org_member(a.org_id, auth.uid())));

ALTER TABLE public.distribution_log
  ADD CONSTRAINT distribution_log_verification_fk
  FOREIGN KEY (verification_id) REFERENCES public.update_verifications(id) ON DELETE SET NULL;

ALTER TABLE public.audit_runs
  ADD COLUMN IF NOT EXISTS links JSONB;
