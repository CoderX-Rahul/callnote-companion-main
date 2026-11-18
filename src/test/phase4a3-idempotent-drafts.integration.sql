-- Idempotent draft requests and report keys. The local SQL runner rolls this back.
BEGIN;

DO $$
DECLARE
  mr_one uuid := '00000000-0000-4000-8000-000000000002';
  mr_two uuid;
  owner_id uuid;
  org_id uuid;
  request_key uuid := '73000000-0000-4000-8000-000000000001';
  report_key uuid := '73000000-0000-4000-8000-000000000002';
  report_id uuid;
  inserted integer;
  constraint_name text;
  relation_acl_count integer;
BEGIN
  SELECT id INTO mr_two FROM public.mr_profiles WHERE employee_code = 'DEV-MR-A1';
  IF mr_two IS NULL THEN RAISE EXCEPTION 'FAIL: DEV-MR-A1 local hierarchy fixture is missing.'; END IF;

  -- The same client UUID is isolated by the profile component of the primary key.
  INSERT INTO public.ai_draft_requests (mr_profile_id, client_draft_id, note_sha256, status)
  VALUES
    (mr_one, request_key, repeat('a', 64), 'processing'),
    (mr_two, request_key, repeat('a', 64), 'processing');
  IF (SELECT count(*) FROM public.ai_draft_requests WHERE client_draft_id = request_key) <> 2 THEN
    RAISE EXCEPTION 'FAIL: identical keys were not independent for two MRs.';
  END IF;

  INSERT INTO public.ai_draft_requests (mr_profile_id, client_draft_id, note_sha256, status)
  VALUES (mr_one, request_key, repeat('a', 64), 'processing')
  ON CONFLICT (mr_profile_id, client_draft_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted <> 0 OR (SELECT count(*) FROM public.ai_draft_requests WHERE mr_profile_id = mr_one AND client_draft_id = request_key) <> 1 THEN
    RAISE EXCEPTION 'FAIL: duplicate claim inserted a second request.';
  END IF;

  SELECT user_id, organization_id INTO owner_id, org_id
  FROM public.mr_profiles WHERE id = mr_one;
  INSERT INTO public.call_reports (organization_id, mr_profile_id, client_draft_id, updated_by, original_note, status)
  VALUES (org_id, mr_one, report_key, owner_id, 'Idempotency SQL fixture', 'draft')
  RETURNING id INTO report_id;

  -- The partial unique index prevents a second call report for the same owner/key.
  BEGIN
    INSERT INTO public.call_reports (organization_id, mr_profile_id, client_draft_id, updated_by, original_note, status)
    VALUES (org_id, mr_one, report_key, owner_id, 'Duplicate Idempotency SQL fixture', 'draft');
    RAISE EXCEPTION 'TEST FAIL: duplicate call_reports client key was accepted.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'call_reports_mr_profile_client_draft_id_uidx' THEN RAISE; END IF;
  END;

  -- A draft key cannot be changed after insert.
  BEGIN
    UPDATE public.call_reports SET client_draft_id = '73000000-0000-4000-8000-000000000003' WHERE id = report_id;
    RAISE EXCEPTION 'TEST FAIL: draft client key was editable.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%Client draft key is immutable%' THEN RAISE; END IF;
  END;

  UPDATE public.call_reports SET
    doctor_id = 'DR-1001', call_date_only = '2026-11-17',
    product_ids = ARRAY['PR-201'], product_names = ARRAY['Cardiovex'],
    purpose = 'Idempotency lock fixture', status = 'approved', updated_by = owner_id
  WHERE id = report_id;
  BEGIN
    UPDATE public.call_reports SET client_draft_id = '73000000-0000-4000-8000-000000000004' WHERE id = report_id;
    RAISE EXCEPTION 'TEST FAIL: approved report client key was editable.' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE '%Approved reports are locked%' THEN RAISE; END IF;
  END;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_draft_requests'::regclass) THEN
    RAISE EXCEPTION 'FAIL: ai_draft_requests RLS is not enabled.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_draft_requests') THEN
    RAISE EXCEPTION 'FAIL: ai_draft_requests unexpectedly has a browser policy.';
  END IF;
  IF has_table_privilege('anon', 'public.ai_draft_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.ai_draft_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'FAIL: browser role has privileges on ai_draft_requests.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ai_draft_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'FAIL: service_role is missing ai_draft_requests privileges.';
  END IF;
  SELECT count(*) INTO relation_acl_count
  FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
  WHERE c.oid = 'public.ai_draft_requests'::regclass AND acl.grantee = 0;
  IF relation_acl_count <> 0 THEN RAISE EXCEPTION 'FAIL: PUBLIC retains ai_draft_requests privileges.'; END IF;
  IF has_function_privilege('anon', 'public.guard_call_report_client_draft_id()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_call_report_client_draft_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: browser role can execute the client-key guard.';
  END IF;
END;
$$;

ROLLBACK;
