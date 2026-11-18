-- Keep the report edit counter aligned with the POB projection audit row.
CREATE OR REPLACE FUNCTION public.increment_pob_edit_count() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.pob IS DISTINCT FROM OLD.pob THEN
    NEW.edit_count := NEW.edit_count + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER z_increment_pob_edit_count
BEFORE UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.increment_pob_edit_count();
REVOKE ALL ON FUNCTION public.increment_pob_edit_count() FROM PUBLIC, anon, authenticated;
