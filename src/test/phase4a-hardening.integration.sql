-- Phase 4A hardening integration test (migration 0010). Runs in one transaction and rolls back.
-- Requires 0009 and 0010 applied, and the seeded demo profile/auth user from 0009.
BEGIN;

-- 1. Browser roles have no privileges on the ownership tables; service_role keeps full access.
DO $$
DECLARE r text; t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.organizations','public.mr_profiles'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
        IF has_table_privilege(r, t, p) THEN RAISE EXCEPTION 'FAIL: % has % on %', r, p, t; END IF;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('service_role', t, 'SELECT') THEN RAISE EXCEPTION 'FAIL: service_role lost access to %', t; END IF;
  END LOOP;
END $$;

-- 2. Fixture draft owned by the demo profile.
INSERT INTO public.call_reports (id, organization_id, mr_profile_id, original_note, status)
VALUES ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Hardening fixture note', 'draft');

-- 3. Intelligence change writes an audit row carrying the actor, in the same transaction.
UPDATE public.call_reports
SET intelligence = '{"competitors":[{"original_mention":"FixtureCor","brand_discussed":"FixtureCor","candidate_ids":[],"ambiguous":false,"sentiment":"Unknown","reason_for_preference":"Unknown","preference_detail":null,"evidence":null,"product_id":null,"identity_confirmed":false}],"barriers":[]}'::jsonb,
    updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
WHERE id = '30000000-0000-4000-8000-000000000001';
DO $$
DECLARE actor uuid; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.report_competitors WHERE report_id = '30000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: competitor projection rows = %', n; END IF;
  SELECT actor_user_id INTO actor FROM public.report_edits WHERE report_id = '30000000-0000-4000-8000-000000000001' AND field = 'intelligence';
  IF actor IS DISTINCT FROM '1d528779-5df6-47e2-a12c-8799da249ff7' THEN RAISE EXCEPTION 'FAIL: intelligence audit actor missing (got %)', actor; END IF;
END $$;

-- 4. Effectiveness change writes an audit row carrying the actor.
UPDATE public.call_reports
SET effectiveness = '{"samples":[],"collateral":[{"material_type":"Dosage chart","detail":null}],"commitments":[],"hcp_tier":null,"access_quality":"Unknown"}'::jsonb,
    updated_by = '1d528779-5df6-47e2-a12c-8799da249ff7'
WHERE id = '30000000-0000-4000-8000-000000000001';
DO $$
DECLARE actor uuid; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.report_collateral WHERE report_id = '30000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: collateral projection rows = %', n; END IF;
  SELECT actor_user_id INTO actor FROM public.report_edits WHERE report_id = '30000000-0000-4000-8000-000000000001' AND field = 'effectiveness';
  IF actor IS DISTINCT FROM '1d528779-5df6-47e2-a12c-8799da249ff7' THEN RAISE EXCEPTION 'FAIL: effectiveness audit actor missing (got %)', actor; END IF;
END $$;

-- 5. Child rows still cannot be written directly (guard trigger unchanged).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.report_collateral (report_id, position, material_type) VALUES ('30000000-0000-4000-8000-000000000001', 99, 'Reminder card');
    RAISE EXCEPTION 'FAIL: direct child-table write accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%must be changed through its report%' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
