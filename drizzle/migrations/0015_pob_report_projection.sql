-- Part B2: canonical POB document, immutable extraction snapshot and normalized projection.
ALTER TABLE public.call_reports
  ADD COLUMN pob jsonb NOT NULL DEFAULT '{"lines":[]}'::jsonb,
  ADD COLUMN ai_pob jsonb NOT NULL DEFAULT '{"lines":[]}'::jsonb,
  ADD COLUMN extraction_schema_version integer NOT NULL DEFAULT 2;
COMMENT ON COLUMN public.call_reports.pob IS 'Optional editable canonical order-booking document; projected transactionally into report_pob_items.';
COMMENT ON COLUMN public.call_reports.ai_pob IS 'Immutable initial POB extraction snapshot.';

CREATE TABLE public.report_pob_items (
  report_id uuid NOT NULL REFERENCES public.call_reports(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  product_mention text NOT NULL,
  product_id text REFERENCES public.products(id),
  quantity integer CHECK (quantity IS NULL OR quantity >= 0),
  scheme_id uuid REFERENCES public.product_schemes(id),
  free_quantity integer NOT NULL DEFAULT 0 CHECK (free_quantity >= 0),
  unit_mrp_snapshot numeric(10,2) CHECK (unit_mrp_snapshot IS NULL OR unit_mrp_snapshot >= 0),
  discount_pct_snapshot numeric(5,2) CHECK (discount_pct_snapshot IS NULL OR discount_pct_snapshot BETWEEN 0 AND 100),
  line_value numeric(12,2) CHECK (line_value IS NULL OR line_value >= 0),
  status text NOT NULL CHECK (status IN ('Booked','Tentative','Unknown')),
  stated_unit_price numeric(10,2) CHECK (stated_unit_price IS NULL OR stated_unit_price >= 0),
  evidence text,
  PRIMARY KEY(report_id, position)
);
ALTER TABLE public.report_pob_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_pob_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.report_pob_items TO service_role;

CREATE OR REPLACE FUNCTION public.validate_report_pob() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.ai_pob IS DISTINCT FROM OLD.ai_pob OR NEW.extraction_schema_version IS DISTINCT FROM OLD.extraction_schema_version THEN
      RAISE EXCEPTION 'Extraction provenance is immutable.';
    END IF;
    IF OLD.status='approved' AND NEW.pob IS DISTINCT FROM OLD.pob THEN
      RAISE EXCEPTION 'Approved reports are locked.';
    END IF;
  END IF;
  IF jsonb_typeof(NEW.pob) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.pob->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid POB document.';
  END IF;
  IF jsonb_typeof(NEW.ai_pob) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.ai_pob->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid AI POB snapshot.';
  END IF;
  IF jsonb_array_length(NEW.pob->'lines') > 30 OR jsonb_array_length(NEW.ai_pob->'lines') > 30 THEN
    RAISE EXCEPTION 'Too many POB lines.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.pob->'lines') LOOP
    IF COALESCE(item->>'status','') NOT IN ('Booked','Tentative','Unknown') THEN RAISE EXCEPTION 'Invalid POB status.'; END IF;
    IF NULLIF(item->>'quantity','') IS NOT NULL AND (item->>'quantity') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid POB quantity.'; END IF;
    IF NULLIF(item->>'free_quantity','') IS NOT NULL AND (item->>'free_quantity') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid POB free quantity.'; END IF;
    IF NULLIF(item->>'evidence','') IS NOT NULL AND (length(item->>'evidence') < 5 OR strpos(NEW.original_note,item->>'evidence')=0) THEN RAISE EXCEPTION 'POB evidence must be a verbatim quote of at least five characters.'; END IF;
    IF (NULLIF(item->>'quantity','') IS NOT NULL OR NULLIF(item->>'stated_unit_price','') IS NOT NULL)
       AND NULLIF(item->>'evidence','') IS NULL THEN RAISE EXCEPTION 'POB numeric values require verified evidence.'; END IF;
    IF NULLIF(item->>'stated_unit_price','') IS NOT NULL AND (item->>'stated_unit_price') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Invalid stated POB price.'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER a_validate_report_pob BEFORE INSERT OR UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.validate_report_pob();

CREATE OR REPLACE FUNCTION public.project_report_pob() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; n integer := 0;
BEGIN
  IF TG_OP='UPDATE' AND NEW.pob IS NOT DISTINCT FROM OLD.pob THEN RETURN NEW; END IF;
  DELETE FROM public.report_pob_items WHERE report_id=NEW.id;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.pob->'lines') LOOP
    INSERT INTO public.report_pob_items(report_id,position,product_mention,product_id,quantity,scheme_id,free_quantity,unit_mrp_snapshot,discount_pct_snapshot,line_value,status,stated_unit_price,evidence)
    VALUES(NEW.id,n,item->>'product_mention',NULLIF(item->>'product_id',''),NULLIF(item->>'quantity','')::integer,NULLIF(item->>'scheme_id','')::uuid,
      COALESCE(NULLIF(item->>'free_quantity','')::integer,0),NULLIF(item->>'unit_mrp_snapshot','')::numeric,NULLIF(item->>'discount_pct_snapshot','')::numeric,
      NULLIF(item->>'line_value','')::numeric,item->>'status',NULLIF(item->>'stated_unit_price','')::numeric,NULLIF(item->>'evidence',''));
    n:=n+1;
  END LOOP;
  IF TG_OP='UPDATE' THEN
    INSERT INTO public.report_edits(report_id,field,old_value,new_value,actor_user_id)
    VALUES(NEW.id,'pob',OLD.pob::text,NEW.pob::text,NEW.updated_by);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_report_pob AFTER INSERT OR UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.project_report_pob();

CREATE TRIGGER guard_pob_projection BEFORE INSERT OR UPDATE OR DELETE ON public.report_pob_items
FOR EACH ROW EXECUTE FUNCTION public.guard_intelligence_projection();
REVOKE ALL ON FUNCTION public.validate_report_pob(), public.project_report_pob() FROM PUBLIC, anon, authenticated;
