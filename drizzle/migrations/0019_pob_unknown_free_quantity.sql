-- Unknown quantity/scheme cannot be presented as zero free units.
ALTER TABLE public.report_pob_items ALTER COLUMN free_quantity DROP NOT NULL;
ALTER TABLE public.report_pob_items ALTER COLUMN free_quantity DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.project_report_pob() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; n integer := 0;
BEGIN
  IF TG_OP='UPDATE' AND NEW.pob IS NOT DISTINCT FROM OLD.pob THEN RETURN NEW; END IF;
  DELETE FROM public.report_pob_items WHERE report_id=NEW.id;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.pob->'lines') LOOP
    INSERT INTO public.report_pob_items(report_id,position,product_mention,product_id,quantity,scheme_id,free_quantity,unit_mrp_snapshot,discount_pct_snapshot,line_value,status,stated_unit_price,evidence)
    VALUES(NEW.id,n,item->>'product_mention',NULLIF(item->>'product_id',''),NULLIF(item->>'quantity','')::integer,NULLIF(item->>'scheme_id','')::uuid,
      NULLIF(item->>'free_quantity','')::integer,NULLIF(item->>'unit_mrp_snapshot','')::numeric,NULLIF(item->>'discount_pct_snapshot','')::numeric,
      NULLIF(item->>'line_value','')::numeric,item->>'status',NULLIF(item->>'stated_unit_price','')::numeric,NULLIF(item->>'evidence',''));
    n:=n+1;
  END LOOP;
  IF TG_OP='UPDATE' THEN
    INSERT INTO public.report_edits(report_id,field,old_value,new_value,actor_user_id)
    VALUES(NEW.id,'pob',OLD.pob::text,NEW.pob::text,NEW.updated_by);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_report_pob() FROM PUBLIC, anon, authenticated;
