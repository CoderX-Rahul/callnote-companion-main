-- Part B POB projection, immutability, audit and monthly IST aggregate.
BEGIN;
DO $$
DECLARE
  owner_id uuid;
  org_id uuid;
  v_report_id uuid;
  unknown_report_id uuid;
  result record;
  doc jsonb := '{"lines":[{"product_mention":"Cardiovex 10 mg","candidate_ids":["PR-201"],"product_id":"PR-201","quantity":20,"scheme_mention":"10+1","scheme_id":null,"status":"Booked","free_quantity":2,"unit_mrp_snapshot":125.00,"discount_pct_snapshot":null,"line_value":2500.00,"stated_unit_price":125.00,"evidence":"Booked 20 Cardiovex with 10+1"}]}'::jsonb;
BEGIN
  SELECT user_id, organization_id INTO owner_id, org_id FROM public.mr_profiles WHERE employee_code='DEV-MR-A1';
  IF owner_id IS NULL THEN RAISE EXCEPTION 'FAIL: local POB hierarchy fixture is missing.'; END IF;
  INSERT INTO public.call_reports(organization_id,mr_profile_id,updated_by,original_note,status,ai_pob)
  VALUES(org_id,(SELECT id FROM public.mr_profiles WHERE employee_code='DEV-MR-A1'),owner_id,'Booked 20 Cardiovex with 10+1','draft',doc)
  RETURNING id INTO v_report_id;

  BEGIN
    UPDATE public.call_reports SET pob='{"lines":[{"product_mention":"Cardiovex","quantity":99,"status":"Booked","evidence":"not in note","stated_unit_price":12}]}'::jsonb WHERE id=v_report_id;
    RAISE EXCEPTION 'TEST FAIL: non-verbatim POB evidence was accepted.' USING ERRCODE='P0001';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='TEST FAIL: non-verbatim POB evidence was accepted.' THEN RAISE; END IF;
  END;

  UPDATE public.call_reports SET pob=doc, updated_by=owner_id WHERE id=v_report_id;
  IF (SELECT edit_count FROM public.call_reports WHERE id=v_report_id)<>1 THEN
    RAISE EXCEPTION 'FAIL: POB changes are missing from the edit counter.';
  END IF;
  UPDATE public.call_reports SET
    doctor_id='DR-1001', call_date_only='2025-02-17', product_ids=ARRAY['PR-201'],
    purpose='POB SQL fixture', status='approved', updated_by=owner_id
  WHERE id=v_report_id;
  IF NOT EXISTS(SELECT 1 FROM public.report_pob_items WHERE report_pob_items.report_id=v_report_id AND status='Booked' AND quantity=20 AND line_value=2500.00 AND free_quantity=2) THEN
    RAISE EXCEPTION 'FAIL: canonical POB projection is missing or incorrect.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.report_edits WHERE report_edits.report_id=v_report_id AND field='pob' AND actor_user_id=owner_id) THEN
    RAISE EXCEPTION 'FAIL: POB audit actor was not copied from updated_by.';
  END IF;
  BEGIN
    INSERT INTO public.report_pob_items(report_id,position,product_mention,status)
    VALUES(v_report_id,99,'direct write attempt','Booked');
    RAISE EXCEPTION 'TEST FAIL: direct POB projection write was accepted.' USING ERRCODE='P0001';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='TEST FAIL: direct POB projection write was accepted.' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.call_reports SET pob='{"lines":[]}'::jsonb WHERE id=v_report_id;
    RAISE EXCEPTION 'TEST FAIL: approved POB edit was accepted.' USING ERRCODE='P0001';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='TEST FAIL: approved POB edit was accepted.' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.call_reports SET ai_pob='{"lines":[]}'::jsonb WHERE id=v_report_id;
    RAISE EXCEPTION 'TEST FAIL: AI POB snapshot was mutable.' USING ERRCODE='P0001';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='TEST FAIL: AI POB snapshot was mutable.' THEN RAISE; END IF;
  END;

  SELECT * INTO result FROM public.pob_monthly_totals(org_id,ARRAY[(SELECT mr_profile_id FROM public.call_reports WHERE id=v_report_id)],'2025-02-01','2025-02-28');
  IF result.approved_calls<>1 OR result.booked_calls<>1 OR result.booked_lines<>1 OR result.booked_value<>2500.00 THEN
    RAISE EXCEPTION 'FAIL: monthly POB RPC returned unexpected totals.';
  END IF;
  INSERT INTO public.call_reports(organization_id,mr_profile_id,updated_by,original_note,status)
  VALUES(org_id,(SELECT id FROM public.mr_profiles WHERE employee_code='DEV-MR-A1'),owner_id,'Discussed a 10+1 offer without a stated quantity','draft')
  RETURNING id INTO unknown_report_id;
  UPDATE public.call_reports SET pob='{"lines":[{"product_mention":"Cardiovex","product_id":"PR-201","quantity":null,"scheme_mention":"10+1","scheme_id":null,"free_quantity":null,"unit_mrp_snapshot":125,"discount_pct_snapshot":null,"line_value":null,"status":"Unknown","stated_unit_price":null,"evidence":"Discussed a 10+1 offer"}]}'::jsonb
  WHERE id=unknown_report_id;
  IF NOT EXISTS(SELECT 1 FROM public.report_pob_items WHERE report_pob_items.report_id=unknown_report_id AND free_quantity IS NULL AND quantity IS NULL AND line_value IS NULL) THEN
    RAISE EXCEPTION 'FAIL: unknown quantity was projected as known free units or value.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.report_pob_items WHERE report_pob_items.report_id=v_report_id AND quantity<0) THEN RAISE EXCEPTION 'FAIL: negative quantity projection exists.'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.report_pob_items'::regclass)
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_pob_items')
    OR has_table_privilege('anon','public.report_pob_items','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated','public.report_pob_items','SELECT,INSERT,UPDATE,DELETE')
    OR has_function_privilege('anon','public.pob_monthly_totals(uuid,uuid[],date,date)','EXECUTE')
    OR has_function_privilege('authenticated','public.pob_monthly_totals(uuid,uuid[],date,date)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: POB RLS or browser-role grants are unsafe.';
  END IF;
END $$;
ROLLBACK;
