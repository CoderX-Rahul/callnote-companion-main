-- Phase 4A soft delete: preserve draft content and audit rows while hiding deleted reports.
ALTER TABLE public.call_reports
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid;

CREATE OR REPLACE FUNCTION public.guard_call_report_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted reports cannot be modified.' USING ERRCODE = '55000';
  END IF;

  IF NEW.deleted_at IS NULL THEN
    IF NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
      RAISE EXCEPTION 'deleted_by is set only when soft deleting a draft.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft reports can be soft deleted.' USING ERRCODE = '55000';
  END IF;
  IF NEW.deleted_by IS NULL OR NEW.deleted_by IS DISTINCT FROM NEW.updated_by THEN
    RAISE EXCEPTION 'deleted_by must match updated_by.' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['deleted_at','deleted_by','updated_by','updated_at','edit_count'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['deleted_at','deleted_by','updated_by','updated_at','edit_count']) THEN
    RAISE EXCEPTION 'Soft deletion cannot change report content.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_call_report_soft_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER call_reports_soft_delete_guard
BEFORE UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_call_report_soft_delete();

CREATE OR REPLACE FUNCTION public.audit_call_report_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.report_edits(report_id, field, old_value, new_value, actor_user_id)
    VALUES (NEW.id, 'deleted_at', NULL, NEW.deleted_at::text, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_call_report_soft_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER call_reports_soft_delete_audit
AFTER UPDATE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.audit_call_report_soft_delete();

CREATE OR REPLACE FUNCTION public.guard_call_report_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.allow_hard_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Hard deletes are disabled; use soft delete or the documented maintenance escape hatch.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_call_report_hard_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER call_reports_hard_delete_guard
BEFORE DELETE ON public.call_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_call_report_hard_delete();
