-- Phase 4A ownership/audit integration test. Runs in a transaction and rolls back.
BEGIN;

-- 1. Backfill integrity: every existing report has an organization and MR profile.
DO $$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing FROM public.call_reports WHERE organization_id IS NULL OR mr_profile_id IS NULL;
  IF missing > 0 THEN RAISE EXCEPTION 'FAIL: % reports without ownership', missing; END IF;
END $$;

-- 2. Fixture: second organization with an MR and a manager; second MR in demo org.
INSERT INTO public.organizations (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Fixture Org B');
INSERT INTO public.mr_profiles (id, user_id, organization_id, full_name, role, active) VALUES
  ('10000000-0000-4000-8000-000000000002', '86ea9840-0a34-4527-a4b7-5174a079dfcc', '10000000-0000-4000-8000-000000000001', 'Fixture MR B', 'mr', true);

-- 3. One profile per auth user: duplicate user_id must be rejected.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mr_profiles (user_id, organization_id, full_name)
    VALUES ('1d528779-5df6-47e2-a12c-8799da249ff7', '00000000-0000-4000-8000-000000000001', 'Duplicate');
    RAISE EXCEPTION 'FAIL: duplicate user_id profile accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- 4. Cross-organization fixture reports.
INSERT INTO public.call_reports (id, organization_id, mr_profile_id, original_note, status, doctor_id, call_date_only, product_ids, purpose)
VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Fixture note A', 'draft', NULL, NULL, '{}', NULL),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Fixture note B', 'draft', NULL, NULL, '{}', NULL);

-- 5. Ownership is immutable once set.
DO $$
BEGIN
  BEGIN
    UPDATE public.call_reports SET mr_profile_id = '10000000-0000-4000-8000-000000000002'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: ownership transfer accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ownership is immutable%' THEN RAISE; END IF;
  END;
END $$;

-- 6. Audit rows record the authenticated actor from updated_by.
UPDATE public.call_reports
SET purpose = 'Fixture purpose', updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
WHERE id = '20000000-0000-4000-8000-000000000001';
DO $$
DECLARE actor uuid;
BEGIN
  SELECT actor_user_id INTO actor FROM public.report_edits
  WHERE report_id = '20000000-0000-4000-8000-000000000001' AND field = 'purpose';
  IF actor IS DISTINCT FROM '1d528779-5df6-47e2-a12c-8799da249ff7' THEN
    RAISE EXCEPTION 'FAIL: audit actor not recorded (got %)', actor;
  END IF;
END $$;

-- 7. Approval still works and locks content; follow_up_done + updated_by remain allowed.
UPDATE public.call_reports
SET status = 'approved', doctor_id = 'DR-1001', call_date_only = '2026-11-05', product_ids = ARRAY['PR-201'], purpose = 'Fixture purpose', follow_up_action = 'Fixture follow-up'
WHERE id = '20000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  BEGIN
    UPDATE public.call_reports SET purpose = 'Changed after approval' WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: approved report content change accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Approved reports are locked%' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.call_reports
SET follow_up_done = true, updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
WHERE id = '20000000-0000-4000-8000-000000000001';

-- 8. New reports cannot be created without ownership (NOT NULL enforced).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.call_reports (original_note) VALUES ('Orphan note');
    RAISE EXCEPTION 'FAIL: report without ownership accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END $$;

ROLLBACK;
