ALTER TABLE public.call_reports ADD COLUMN effectiveness jsonb NOT NULL DEFAULT '{"samples":[],"collateral":[],"commitments":[],"hcp_tier":null,"access_quality":"Unknown"}'::jsonb, ADD COLUMN ai_effectiveness jsonb;
COMMENT ON COLUMN public.call_reports.effectiveness IS 'Canonical optional editable field-effectiveness document; transactionally projected into normalized child rows by trigger.';
COMMENT ON COLUMN public.call_reports.ai_effectiveness IS 'Immutable initial extraction snapshot; original mentions, evidence and uncertainty retained.';
CREATE TABLE public.report_samples (
 report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE, position integer NOT NULL,
 product_mention text NOT NULL, product_id text REFERENCES public.products(id),
 quantity integer, distribution_status text NOT NULL, evidence text,
 PRIMARY KEY(report_id,position),
 CHECK(quantity IS NULL OR quantity >= 0),
 CHECK(distribution_status IN ('Distributed','Planned','Unknown'))
);
GRANT ALL ON public.report_samples TO service_role;
ALTER TABLE public.report_samples ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.report_collateral (
 report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE, position integer NOT NULL,
 material_type text NOT NULL, detail text,
 PRIMARY KEY(report_id,position),
 CHECK(material_type IN ('Clinical trial reprint','Product information brochure','Reminder card','Dosage chart','Approved educational material','Other'))
);
GRANT ALL ON public.report_collateral TO service_role;
ALTER TABLE public.report_collateral ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.report_commitments (
 report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE, position integer NOT NULL,
 commitment_date date, trial_patient_count integer, status text NOT NULL, follow_up_outcome text, evidence text,
 PRIMARY KEY(report_id,position),
 CHECK(trial_patient_count IS NULL OR trial_patient_count >= 0),
 CHECK(status IN ('Doctor commitment','MR follow-up','Confirmed product trial','Prescription conversion','Unknown'))
);
GRANT ALL ON public.report_commitments TO service_role;
ALTER TABLE public.report_commitments ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.validate_report_effectiveness() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; c jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.ai_effectiveness IS DISTINCT FROM OLD.ai_effectiveness THEN RAISE EXCEPTION 'Extraction provenance is immutable.'; END IF;
  IF OLD.status='approved' AND NEW.effectiveness IS DISTINCT FROM OLD.effectiveness THEN RAISE EXCEPTION 'Approved reports are locked.'; END IF;
 END IF;
 IF jsonb_typeof(NEW.effectiveness) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.effectiveness->'samples') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.effectiveness->'collateral') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.effectiveness->'commitments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid effectiveness document.'; END IF;
 IF jsonb_array_length(NEW.effectiveness->'samples')>20 OR jsonb_array_length(NEW.effectiveness->'collateral')>20 OR jsonb_array_length(NEW.effectiveness->'commitments')>10 THEN RAISE EXCEPTION 'Too many effectiveness entries.'; END IF;
 IF NEW.effectiveness->>'hcp_tier' IS NOT NULL AND NEW.effectiveness->>'hcp_tier' NOT IN ('A','B','C','Unclassified') THEN RAISE EXCEPTION 'Invalid HCP tier.'; END IF;
 IF COALESCE(NEW.effectiveness->>'access_quality','Unknown') NOT IN ('Detailed face-to-face interaction','Brief interaction','Clinic assistant only','No access','Unknown') THEN RAISE EXCEPTION 'Invalid access quality.'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'samples') LOOP
  IF s->>'quantity' IS NOT NULL AND (s->>'quantity')::integer < 0 THEN RAISE EXCEPTION 'Sample quantity cannot be negative.'; END IF;
 END LOOP;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'commitments') LOOP
  IF c->>'trial_patient_count' IS NOT NULL AND (c->>'trial_patient_count')::integer < 0 THEN RAISE EXCEPTION 'Trial patient count cannot be negative.'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER a_validate_report_effectiveness BEFORE INSERT OR UPDATE ON public.call_reports FOR EACH ROW EXECUTE FUNCTION public.validate_report_effectiveness();
CREATE OR REPLACE FUNCTION public.project_report_effectiveness() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; c jsonb; m jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.effectiveness IS NOT DISTINCT FROM OLD.effectiveness THEN RETURN NEW; END IF;
 DELETE FROM public.report_samples WHERE report_id=NEW.id;
 DELETE FROM public.report_collateral WHERE report_id=NEW.id;
 DELETE FROM public.report_commitments WHERE report_id=NEW.id;
 n:=0;
 FOR s IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'samples') LOOP
  INSERT INTO public.report_samples(report_id,position,product_mention,product_id,quantity,distribution_status,evidence)
  VALUES(NEW.id,n,s->>'product_mention',NULLIF(s->>'product_id',''),NULLIF(s->>'quantity','')::integer,s->>'distribution_status',s->>'evidence'); n:=n+1;
 END LOOP;
 n:=0;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'collateral') LOOP
  INSERT INTO public.report_collateral(report_id,position,material_type,detail)
  VALUES(NEW.id,n,m->>'material_type',m->>'detail'); n:=n+1;
 END LOOP;
 n:=0;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.effectiveness->'commitments') LOOP
  INSERT INTO public.report_commitments(report_id,position,commitment_date,trial_patient_count,status,follow_up_outcome,evidence)
  VALUES(NEW.id,n,NULLIF(c->>'commitment_date','')::date,NULLIF(c->>'trial_patient_count','')::integer,c->>'status',c->>'follow_up_outcome',c->>'evidence'); n:=n+1;
 END LOOP;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.report_edits(report_id,field,old_value,new_value) VALUES(NEW.id,'effectiveness',OLD.effectiveness::text,NEW.effectiveness::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_report_effectiveness AFTER INSERT OR UPDATE ON public.call_reports FOR EACH ROW EXECUTE FUNCTION public.project_report_effectiveness();
CREATE TRIGGER guard_sample_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_samples FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
CREATE TRIGGER guard_collateral_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_collateral FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
CREATE TRIGGER guard_commitment_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_commitments FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
CREATE OR REPLACE FUNCTION public.audit_report_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; before_value text; after_value text; changes integer := 0; old_products text[]; new_products text[];
BEGIN
 IF OLD.status = 'approved' AND (to_jsonb(NEW) - ARRAY['follow_up_done','updated_at','edit_count']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['follow_up_done','updated_at','edit_count']) THEN RAISE EXCEPTION 'Approved reports are locked.'; END IF;
 IF NEW.original_note IS DISTINCT FROM OLD.original_note THEN RAISE EXCEPTION 'Original notes are immutable.'; END IF;
 IF NEW.normalized_note IS DISTINCT FROM OLD.normalized_note OR NEW.glossary_version IS DISTINCT FROM OLD.glossary_version OR NEW.original_doctor_mention IS DISTINCT FROM OLD.original_doctor_mention THEN RAISE EXCEPTION 'Extraction provenance is immutable.'; END IF;
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
   INSERT INTO public.report_edits(report_id,field,old_value,new_value) VALUES(OLD.id,k,NULLIF(before_value,''),NULLIF(after_value,''));
   IF k NOT IN ('status','follow_up_done') THEN changes:=changes+1; END IF;
  END IF;
 END LOOP;
 IF NEW.intelligence IS DISTINCT FROM OLD.intelligence THEN changes:=changes+1; END IF;
 IF NEW.effectiveness IS DISTINCT FROM OLD.effectiveness THEN changes:=changes+1; END IF;
 NEW.edit_count:=OLD.edit_count+changes; NEW.updated_at:=clock_timestamp();
 IF OLD.status<>'approved' AND NEW.status='approved' THEN NEW.approved_at:=NEW.updated_at; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_report_effectiveness(),public.project_report_effectiveness() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.audit_report_update() FROM PUBLIC,anon,authenticated;