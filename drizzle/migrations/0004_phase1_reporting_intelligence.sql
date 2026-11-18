ALTER TABLE public.call_reports ADD COLUMN normalized_note text, ADD COLUMN glossary_version text, ADD COLUMN original_doctor_mention text;
COMMENT ON COLUMN public.call_reports.normalized_note IS 'Deterministically normalized extraction input; original_note remains immutable.';
CREATE OR REPLACE FUNCTION public.audit_report_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; before_value text; after_value text; changes integer := 0; old_products text[]; new_products text[];
BEGIN
  IF OLD.status = 'approved' AND (to_jsonb(NEW) - ARRAY['follow_up_done','updated_at','edit_count']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['follow_up_done','updated_at','edit_count']) THEN
    RAISE EXCEPTION 'Approved reports are locked.';
  END IF;
  IF NEW.original_note IS DISTINCT FROM OLD.original_note THEN RAISE EXCEPTION 'Original notes are immutable.'; END IF;
  IF NEW.normalized_note IS DISTINCT FROM OLD.normalized_note OR NEW.glossary_version IS DISTINCT FROM OLD.glossary_version OR NEW.original_doctor_mention IS DISTINCT FROM OLD.original_doctor_mention THEN RAISE EXCEPTION 'Extraction provenance is immutable.'; END IF;
  IF NEW.status = 'approved' AND (NEW.doctor_id IS NULL OR (NEW.call_datetime IS NULL AND NEW.call_date_only IS NULL) OR cardinality(NEW.product_ids) = 0 OR NULLIF(btrim(NEW.purpose),'') IS NULL) THEN RAISE EXCEPTION 'Required approval fields are missing.'; END IF;
  IF NEW.call_datetime IS NOT NULL AND NEW.call_date_only IS NOT NULL AND (NEW.call_datetime AT TIME ZONE 'Asia/Kolkata')::date <> NEW.call_date_only THEN RAISE EXCEPTION 'Call date and time disagree.'; END IF;
  IF NEW.follow_up_done IS DISTINCT FROM OLD.follow_up_done AND (OLD.status <> 'approved' OR OLD.follow_up_action IS NULL) THEN RAISE EXCEPTION 'Only approved follow-ups can be completed.'; END IF;
  FOREACH k IN ARRAY ARRAY['call_datetime','call_date_only','doctor_id','product_ids','purpose','feedback','materials_requested','follow_up_action','follow_up_due','follow_up_done','status'] LOOP
    before_value := to_jsonb(OLD)->>k; after_value := to_jsonb(NEW)->>k;
    IF k = 'product_ids' THEN
      SELECT array_agg(v ORDER BY v) INTO old_products FROM unnest(OLD.product_ids) v;
      SELECT array_agg(v ORDER BY v) INTO new_products FROM unnest(NEW.product_ids) v;
      before_value := array_to_string(old_products, ', '); after_value := array_to_string(new_products, ', ');
    END IF;
    IF NULLIF(before_value,'') IS DISTINCT FROM NULLIF(after_value,'') THEN
      INSERT INTO public.report_edits(report_id,field,old_value,new_value) VALUES (OLD.id,k,NULLIF(before_value,''),NULLIF(after_value,''));
      IF k NOT IN ('status','follow_up_done') THEN changes := changes + 1; END IF;
    END IF;
  END LOOP;
  NEW.edit_count := OLD.edit_count + changes;
  NEW.updated_at := clock_timestamp();
  IF OLD.status <> 'approved' AND NEW.status = 'approved' THEN NEW.approved_at := NEW.updated_at; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_report_update() FROM PUBLIC, anon, authenticated;