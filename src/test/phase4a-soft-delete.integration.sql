-- Phase 4A soft-delete integration test. Runs in one transaction and rolls back.
-- Requires the 0009 demo profile/auth user and migrations through 0012.
BEGIN;

INSERT INTO public.call_reports (id, organization_id, mr_profile_id, updated_by, original_note, status)
VALUES (
  '60000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '1d528779-5df6-47e2-a12c-8799da249ff7',
  'Soft delete integration fixture',
  'draft'
);

-- A plain hard DELETE is refused before soft deletion.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.call_reports WHERE id = '60000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST FAIL: plain hard DELETE was allowed.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%Hard deletes are disabled%' THEN RAISE; END IF;
  END;
END;
$$;

-- deleted_by must match the verified actor in updated_by.
DO $$
BEGIN
  BEGIN
    UPDATE public.call_reports
    SET deleted_at = clock_timestamp(), deleted_by = '86ea9840-0a34-4527-a4b7-5174a079dfcc',
        updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
    WHERE id = '60000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST FAIL: mismatched deletion actor was allowed.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%deleted_by must match updated_by%' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE public.call_reports
SET deleted_at = '2026-11-16 10:00:00+00',
    deleted_by = '1d528779-5df6-47e2-a12c-8799da249ff7',
    updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
WHERE id = '60000000-0000-4000-8000-000000000001';

DO $$
DECLARE actor uuid; audit_count integer;
BEGIN
  SELECT count(*) INTO audit_count
  FROM public.report_edits
  WHERE report_id = '60000000-0000-4000-8000-000000000001' AND field = 'deleted_at';
  SELECT actor_user_id INTO actor
  FROM public.report_edits
  WHERE report_id = '60000000-0000-4000-8000-000000000001' AND field = 'deleted_at'
  LIMIT 1;
  IF audit_count <> 1 OR actor IS DISTINCT FROM '1d528779-5df6-47e2-a12c-8799da249ff7' THEN
    RAISE EXCEPTION 'FAIL: soft-delete audit row or actor is missing.';
  END IF;

  BEGIN
    UPDATE public.call_reports SET deleted_at = NULL WHERE id = '60000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST FAIL: deleted_at was cleared.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%Deleted reports cannot be modified%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.call_reports SET purpose = 'edited after deletion' WHERE id = '60000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST FAIL: deleted report was edited.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%Deleted reports cannot be modified%' THEN RAISE; END IF;
  END;
END;
$$;

-- Existing approved reports cannot be soft deleted.
DO $$
DECLARE approved_id uuid;
BEGIN
  SELECT id INTO approved_id FROM public.call_reports WHERE status = 'approved' LIMIT 1;
  IF approved_id IS NULL THEN RAISE EXCEPTION 'FAIL: approved-report fixture is missing.'; END IF;
  BEGIN
    UPDATE public.call_reports
    SET deleted_at = clock_timestamp(), deleted_by = updated_by
    WHERE id = approved_id;
    RAISE EXCEPTION 'TEST FAIL: approved report was soft deleted.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%Only draft reports can be soft deleted%' THEN RAISE; END IF;
  END;
END;
$$;

-- The hard-delete escape hatch is transaction-local and exists for maintenance/test cleanup only.
SELECT set_config('app.allow_hard_delete', 'on', true);
DELETE FROM public.call_reports WHERE id = '60000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.call_reports WHERE id = '60000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: transaction-local hard-delete escape hatch did not work.';
  END IF;
END;
$$;

ROLLBACK;
