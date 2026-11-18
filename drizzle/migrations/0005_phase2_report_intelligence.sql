ALTER TABLE public.call_reports ADD COLUMN intelligence jsonb NOT NULL DEFAULT '{"competitors":[],"barriers":[]}'::jsonb, ADD COLUMN ai_intelligence jsonb;
COMMENT ON COLUMN public.call_reports.intelligence IS 'Canonical optional editable intelligence; transactionally projected into normalized child rows by trigger.';
COMMENT ON COLUMN public.call_reports.ai_intelligence IS 'Immutable initial extraction snapshot; original mentions, evidence and uncertainty retained.';
CREATE TABLE public.report_competitors (
 report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE, position integer NOT NULL,
 original_mention text NOT NULL, brand_discussed text, product_id text REFERENCES public.products(id),
 sentiment text NOT NULL, reason_for_preference text NOT NULL, preference_detail text, evidence text,
 ambiguous boolean NOT NULL DEFAULT false, identity_confirmed boolean NOT NULL DEFAULT false, candidate_ids text[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(report_id,position),
 CHECK(sentiment IN ('Positive','Negative','Neutral','Mixed','Unknown')),
 CHECK(reason_for_preference IN ('Price advantage','Clinical evidence','Brand loyalty','Availability','Efficacy feedback','Tolerability feedback','Promotional activity','Other','Unknown'))
);
GRANT ALL ON public.report_competitors TO service_role;
ALTER TABLE public.report_competitors ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.report_barriers (
 report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE, position integer NOT NULL,
 category text NOT NULL, status text NOT NULL, is_primary boolean NOT NULL DEFAULT false, evidence text, suggested_followup_action text,
 PRIMARY KEY(report_id,position),
 CHECK(category IN ('Price or cost sensitivity','Insufficient clinical evidence or trust','Stock or availability issues','Existing brand loyalty','Patient affordability','Product awareness gap','Doctor not convinced','Other','Unknown','Not discussed')),
 CHECK(status IN ('Open','Resolved','Not discussed','Unknown'))
);
GRANT ALL ON public.report_barriers TO service_role;
ALTER TABLE public.report_barriers ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX report_barriers_one_primary ON public.report_barriers(report_id) WHERE is_primary;
CREATE OR REPLACE FUNCTION public.validate_report_intelligence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; b jsonb; primaries integer := 0;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.ai_intelligence IS DISTINCT FROM OLD.ai_intelligence THEN RAISE EXCEPTION 'Extraction provenance is immutable.'; END IF;
  IF OLD.status='approved' AND NEW.intelligence IS DISTINCT FROM OLD.intelligence THEN RAISE EXCEPTION 'Approved reports are locked.'; END IF;
 END IF;
 IF jsonb_typeof(NEW.intelligence) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.intelligence->'competitors') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.intelligence->'barriers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid intelligence document.'; END IF;
 IF jsonb_array_length(NEW.intelligence->'competitors')>20 OR jsonb_array_length(NEW.intelligence->'barriers')>20 THEN RAISE EXCEPTION 'Too many intelligence entries.'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'competitors') LOOP
  IF NULLIF(c->>'product_id','') IS NOT NULL AND NOT COALESCE((c->>'identity_confirmed')::boolean,false) THEN RAISE EXCEPTION 'Competitor identity must be confirmed.'; END IF;
  IF COALESCE((c->>'ambiguous')::boolean,false) AND COALESCE((c->>'identity_confirmed')::boolean,false) AND NULLIF(c->>'product_id','') IS NULL AND NULLIF(btrim(c->>'brand_discussed'),'') IS NULL THEN RAISE EXCEPTION 'Confirmed competitor brand is missing.'; END IF;
 END LOOP;
 FOR b IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'barriers') LOOP
  IF COALESCE((b->>'primary')::boolean,false) THEN primaries:=primaries+1; END IF;
 END LOOP;
 IF primaries>1 THEN RAISE EXCEPTION 'Only one primary barrier is allowed.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_validate_report_intelligence BEFORE INSERT OR UPDATE ON public.call_reports FOR EACH ROW EXECUTE FUNCTION public.validate_report_intelligence();
CREATE OR REPLACE FUNCTION public.project_report_intelligence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; b jsonb; n integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.intelligence IS NOT DISTINCT FROM OLD.intelligence THEN RETURN NEW; END IF;
 DELETE FROM public.report_competitors WHERE report_id=NEW.id;
 DELETE FROM public.report_barriers WHERE report_id=NEW.id;
 n:=0;
 FOR c IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'competitors') LOOP
  INSERT INTO public.report_competitors(report_id,position,original_mention,brand_discussed,product_id,sentiment,reason_for_preference,preference_detail,evidence,ambiguous,identity_confirmed,candidate_ids)
  VALUES(NEW.id,n,c->>'original_mention',c->>'brand_discussed',NULLIF(c->>'product_id',''),c->>'sentiment',c->>'reason_for_preference',c->>'preference_detail',c->>'evidence',COALESCE((c->>'ambiguous')::boolean,false),COALESCE((c->>'identity_confirmed')::boolean,false),ARRAY(SELECT jsonb_array_elements_text(c->'candidate_ids'))); n:=n+1;
 END LOOP;
 n:=0;
 FOR b IN SELECT value FROM jsonb_array_elements(NEW.intelligence->'barriers') LOOP
  INSERT INTO public.report_barriers(report_id,position,category,status,is_primary,evidence,suggested_followup_action)
  VALUES(NEW.id,n,b->>'category',b->>'status',COALESCE((b->>'primary')::boolean,false),b->>'evidence',b->>'suggested_followup_action'); n:=n+1;
 END LOOP;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.report_edits(report_id,field,old_value,new_value) VALUES(NEW.id,'intelligence',OLD.intelligence::text,NEW.intelligence::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_report_intelligence AFTER INSERT OR UPDATE ON public.call_reports FOR EACH ROW EXECUTE FUNCTION public.project_report_intelligence();
CREATE OR REPLACE FUNCTION public.guard_intelligence_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Intelligence must be changed through its report.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_competitor_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_competitors FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
CREATE TRIGGER guard_barrier_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_barriers FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
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
 NEW.edit_count:=OLD.edit_count+changes; NEW.updated_at:=clock_timestamp();
 IF OLD.status<>'approved' AND NEW.status='approved' THEN NEW.approved_at:=NEW.updated_at; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_report_intelligence(),public.project_report_intelligence(),public.guard_intelligence_projection(),public.audit_report_update() FROM PUBLIC,anon,authenticated;