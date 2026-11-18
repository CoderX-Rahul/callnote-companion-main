-- Phase 3 field-effectiveness database checks. Runs in a transaction; rolls back all fixtures.
BEGIN;

-- Fixture report with empty effectiveness: no child rows projected.
INSERT INTO public.call_reports(id, original_note, status)
VALUES ('f3a3a3a3-0000-4000-8000-000000000003', 'Phase 3 integration fixture note', 'draft');

DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  IF (SELECT count(*) FROM public.report_samples WHERE report_id = rid) <> 0
   OR (SELECT count(*) FROM public.report_collateral WHERE report_id = rid) <> 0
   OR (SELECT count(*) FROM public.report_commitments WHERE report_id = rid) <> 0 THEN
    RAISE EXCEPTION 'empty effectiveness must project no child rows';
  END IF;
END $$;

-- Atomic projection + audit on update.
UPDATE public.call_reports SET effectiveness = '{
  "samples":[{"product_mention":"Cardiovex","candidate_ids":["PR-201"],"quantity":10,"distribution_status":"Distributed","evidence":"Dropped 10 samples","product_id":"PR-201"}],
  "collateral":[{"material_type":"Dosage chart","detail":null},{"material_type":"Reminder card","detail":"left at reception"}],
  "commitments":[{"commitment_date":"2026-11-15","trial_patient_count":5,"status":"Doctor commitment","follow_up_outcome":null,"evidence":"committed to try on 5 patients"}],
  "hcp_tier":"B","access_quality":"Brief interaction"}'::jsonb
WHERE id = 'f3a3a3a3-0000-4000-8000-000000000003';

DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  IF (SELECT count(*) FROM public.report_samples WHERE report_id = rid) <> 1
   OR (SELECT count(*) FROM public.report_collateral WHERE report_id = rid) <> 2
   OR (SELECT count(*) FROM public.report_commitments WHERE report_id = rid) <> 1 THEN
    RAISE EXCEPTION 'effectiveness projection failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.report_samples WHERE report_id = rid AND quantity = 10 AND distribution_status = 'Distributed' AND product_id = 'PR-201') THEN
    RAISE EXCEPTION 'sample row mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.report_edits WHERE report_id = rid AND field = 'effectiveness') THEN
    RAISE EXCEPTION 'effectiveness audit row missing';
  END IF;
END $$;

-- Failed update rolls back atomically: negative quantity rejected, prior projection intact.
DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  BEGIN
    UPDATE public.call_reports SET effectiveness = jsonb_set(effectiveness, '{samples,0,quantity}', '-2')
    WHERE id = rid;
    RAISE EXCEPTION 'negative sample quantity was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'negative sample quantity was accepted' THEN RAISE; END IF;
  END;
  IF (SELECT quantity FROM public.report_samples WHERE report_id = rid AND position = 0) <> 10 THEN
    RAISE EXCEPTION 'failed update was not rolled back';
  END IF;
END $$;

-- Direct child writes are rejected outside the projection trigger.
DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  BEGIN
    INSERT INTO public.report_samples(report_id, position, product_mention, distribution_status)
    VALUES (rid, 9, 'Direct', 'Distributed');
    RAISE EXCEPTION 'direct sample write was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'direct sample write was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Invalid HCP tier rejected; tier and access quality stay separate.
DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  BEGIN
    UPDATE public.call_reports SET effectiveness = jsonb_set(effectiveness, '{hcp_tier}', '"A+"') WHERE id = rid;
    RAISE EXCEPTION 'invalid HCP tier was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'invalid HCP tier was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Approval with date only, null time and optional effectiveness intact.
UPDATE public.call_reports
SET doctor_id = 'DR-1001', doctor_name = 'Dr. Anita Sharma', call_date_only = '2026-10-31',
    product_ids = ARRAY['PR-201'], product_names = ARRAY['Cardiovex'], purpose = 'Product discussion', status = 'approved'
WHERE id = 'f3a3a3a3-0000-4000-8000-000000000003';

DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.call_reports WHERE id = rid AND status = 'approved' AND call_datetime IS NULL) THEN
    RAISE EXCEPTION 'date-only approval with null time failed';
  END IF;
END $$;

-- Approved effectiveness is locked; ai_effectiveness provenance immutable.
DO $$
DECLARE rid uuid := 'f3a3a3a3-0000-4000-8000-000000000003';
BEGIN
  BEGIN
    UPDATE public.call_reports SET effectiveness = '{"samples":[],"collateral":[],"commitments":[],"hcp_tier":null,"access_quality":"Unknown"}'::jsonb WHERE id = rid;
    RAISE EXCEPTION 'approved effectiveness edit was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'approved effectiveness edit was accepted' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.call_reports SET ai_effectiveness = '{"samples":[],"collateral":[],"commitments":[],"hcp_tier":null,"access_quality":"Unknown"}'::jsonb WHERE id = rid;
    RAISE EXCEPTION 'ai_effectiveness change was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'ai_effectiveness change was accepted' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
