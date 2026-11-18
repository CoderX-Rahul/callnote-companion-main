-- Make AI-created drafts idempotent per owner and client-generated UUID.
ALTER TABLE public.call_reports
  ADD COLUMN client_draft_id uuid;

CREATE UNIQUE INDEX call_reports_mr_profile_client_draft_id_uidx
  ON public.call_reports (mr_profile_id, client_draft_id)
  WHERE client_draft_id IS NOT NULL;

CREATE TABLE public.ai_draft_requests (
  mr_profile_id uuid NOT NULL REFERENCES public.mr_profiles(id) ON DELETE CASCADE,
  client_draft_id uuid NOT NULL,
  note_sha256 text NOT NULL CHECK (note_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('processing', 'done', 'failed')),
  report_id uuid REFERENCES public.call_reports(id) ON DELETE CASCADE,
  error_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mr_profile_id, client_draft_id)
);

ALTER TABLE public.ai_draft_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_draft_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_draft_requests TO service_role;

-- The existing approved lock compares the whole row, so the new column is locked automatically.
-- This second guard also makes the key immutable on drafts after the insert.
CREATE OR REPLACE FUNCTION public.guard_call_report_client_draft_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.client_draft_id IS DISTINCT FROM OLD.client_draft_id THEN
    RAISE EXCEPTION 'Client draft key is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_call_report_client_draft_id() FROM PUBLIC, anon, authenticated;

-- Run after report_update_atomic_audit so approved updates are rejected by the existing whole-row lock.
CREATE TRIGGER z_call_reports_client_draft_id_guard
BEFORE UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_call_report_client_draft_id();
