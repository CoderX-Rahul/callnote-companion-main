CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mr_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  full_name text NOT NULL,
  employee_code text,
  division text,
  territory text,
  headquarters text,
  role text NOT NULL DEFAULT 'mr' CHECK (role IN ('mr','manager','admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.mr_profiles TO service_role;
ALTER TABLE public.mr_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_reports
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id),
  ADD COLUMN mr_profile_id uuid REFERENCES public.mr_profiles(id),
  ADD COLUMN updated_by uuid;
ALTER TABLE public.report_edits ADD COLUMN actor_user_id uuid;

-- Replace the audit trigger before backfill: ownership becomes immutable once set
-- (OLD.mr_profile_id IS NOT NULL), so the one-time backfill of legacy rows is allowed
-- and every later ownership change is rejected.
CREATE OR REPLACE FUNCTION public.audit_report_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; before_value text; after_value text; changes integer := 0; old_products text[]; new_products text[];
BEGIN
 IF OLD.status = 'approved' AND OLD.mr_profile_id IS NOT NULL AND (to_jsonb(NEW) - ARRAY['follow_up_done','updated_at','edit_count','updated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['follow_up_done','updated_at','edit_count','updated_by']) THEN RAISE EXCEPTION 'Approved reports are locked.'; END IF;
 IF NEW.original_note IS DISTINCT FROM OLD.original_note THEN RAISE EXCEPTION 'Original notes are immutable.'; END IF;
 IF NEW.normalized_note IS DISTINCT FROM OLD.normalized_note OR NEW.glossary_version IS DISTINCT FROM OLD.glossary_version OR NEW.original_doctor_mention IS DISTINCT FROM OLD.original_doctor_mention THEN RAISE EXCEPTION 'Extraction provenance is immutable.'; END IF;
 IF OLD.mr_profile_id IS NOT NULL AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.mr_profile_id IS DISTINCT FROM OLD.mr_profile_id) THEN RAISE EXCEPTION 'Report ownership is immutable.'; END IF;
 IF NEW.status = 'approved' AND (NEW.doctor_id IS NULL OR (NEW.call_datetime IS NULL AND NEW.call_date_only IS NULL) OR cardinality(NEW.product_ids) = 0 OR NULLIF(btrim(NEW.purpose),'') IS NULL) THEN RAISE EXCEPTION 'Required approval fields are missing.'; END IF;
 IF NEW.call_datetime IS NOT NULL AND NEW.call_date_only IS NOT NULL AND (NEW.call_datetime AT TIME ZONE 'Asia/Kolkata')::date <> NEW.call_date_only THEN RAISE EXCEPTION 'Call date and time disagree.'; END IF;
 IF NEW.follow_up_done IS DISTINCT FROM OLD.follow_up_done AND (OLD.status <> 'approved' OR OLD.follow_up_action IS NULL) THEN RAISE EXCEPTION 'Only approved follow-ups can be completed.'; END IF;
 FOREACH k IN ARRAY ARRAY['call_datetime','call_date_only','doctor_id','product_ids','purpose','feedback','materials_requested','follow_up_action','follow_up_due','follow_up_done','status'] LOOP
  before_value := to_jsonb(OLD)->>k; after_value := to_jsonb(NEW)->>k;
  IF k='product_ids' THEN
   SELECT array_agg(v ORDER BY v) INTO old_products FROM unnest(OLD.product_ids) v;
   SELECT array_agg(v ORDER BY v) INTO new_products FROM unnest(NEW.product_ids) v;
   before_value:=array_to_string(old_products,', '); after_value:=array_to_string(new_products,', ');
  END IF;
  IF NULLIF(before_value,'') IS DISTINCT FROM NULLIF(after_value,'') THEN
   INSERT INTO public.report_edits(report_id,field,old_value,new_value,actor_user_id) VALUES(OLD.id,k,NULLIF(before_value,''),NULLIF(after_value,''),NEW.updated_by);
   IF k NOT IN ('status','follow_up_done') THEN changes:=changes+1; END IF;
  END IF;
 END LOOP;
 IF NEW.intelligence IS DISTINCT FROM OLD.intelligence THEN changes:=changes+1; END IF;
 IF NEW.effectiveness IS DISTINCT FROM OLD.effectiveness THEN changes:=changes+1; END IF;
 NEW.edit_count:=OLD.edit_count+changes; NEW.updated_at:=clock_timestamp();
 IF OLD.status<>'approved' AND NEW.status='approved' THEN NEW.approved_at:=NEW.updated_at; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_report_update() FROM PUBLIC, anon, authenticated;

-- Provision the existing demo workspace (authorized provisioning; no self-service).
INSERT INTO public.organizations (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Demo Organization (fictional)');
INSERT INTO public.mr_profiles (id, user_id, organization_id, full_name, employee_code, division, territory, headquarters, role, active)
VALUES ('00000000-0000-4000-8000-000000000002', '1d528779-5df6-47e2-a12c-8799da249ff7', '00000000-0000-4000-8000-000000000001', 'Demo MR', 'EMP-DEMO-001', 'Demo Division', 'Demo Territory', 'Kolkata', 'mr', true);

UPDATE public.call_reports
SET organization_id = '00000000-0000-4000-8000-000000000001', mr_profile_id = '00000000-0000-4000-8000-000000000002'
WHERE mr_profile_id IS NULL;

ALTER TABLE public.call_reports
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN mr_profile_id SET NOT NULL;
CREATE INDEX call_reports_mr_profile_idx ON public.call_reports (mr_profile_id);
CREATE INDEX call_reports_organization_idx ON public.call_reports (organization_id);