-- All fixtures and audit records roll back, including on assertion failure.
DO $$
DECLARE rid uuid; payload jsonb; n integer; blocked boolean; passed boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.call_reports(original_note,doctor_id,call_date_only,product_ids,purpose)
  VALUES('Phase 2 transactional fixture','DR-1001','2026-11-02',ARRAY['PR-201'],'Detailing') RETURNING id INTO rid;
  IF EXISTS(SELECT 1 FROM public.report_competitors WHERE report_id=rid) THEN RAISE EXCEPTION 'Empty optional intelligence created rows'; END IF;
  payload:='{"competitors":[{"original_mention":"Valuecor","brand_discussed":"Valuecor","product_id":null,"candidate_ids":[],"ambiguous":false,"identity_confirmed":false,"sentiment":"Positive","reason_for_preference":"Price advantage","preference_detail":null,"evidence":"Valuecor costs less"}],"barriers":[{"category":"Price or cost sensitivity","status":"Open","primary":true,"evidence":"Cost is the main barrier","suggested_followup_action":null}]}'::jsonb;
  UPDATE public.call_reports SET intelligence=payload WHERE id=rid;
  IF (SELECT count(*) FROM public.report_competitors WHERE report_id=rid)<>1 OR
     (SELECT count(*) FROM public.report_barriers WHERE report_id=rid)<>1 OR
     (SELECT edit_count FROM public.call_reports WHERE id=rid)<>1 OR
     NOT EXISTS(SELECT 1 FROM public.report_edits WHERE report_id=rid AND field='intelligence') THEN RAISE EXCEPTION 'Atomic projection/audit failed'; END IF;
  SELECT count(*) INTO n FROM public.report_edits WHERE report_id=rid;
  blocked:=false;
  BEGIN
   UPDATE public.call_reports SET intelligence=jsonb_set(payload,'{competitors,0,sentiment}','"Invented"') WHERE id=rid;
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  IF NOT blocked OR (SELECT intelligence FROM public.call_reports WHERE id=rid)<>payload OR
     (SELECT sentiment FROM public.report_competitors WHERE report_id=rid)<>'Positive' OR
     (SELECT count(*) FROM public.report_edits WHERE report_id=rid)<>n THEN RAISE EXCEPTION 'Failed update was not atomic'; END IF;
  blocked:=false;
  BEGIN
   UPDATE public.call_reports SET intelligence=jsonb_set(payload,'{competitors,0,product_id}','"PR-201"') WHERE id=rid;
  EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Unconfirmed master identity accepted'; END IF;
  blocked:=false;
  BEGIN UPDATE public.report_competitors SET sentiment='Negative' WHERE report_id=rid;
  EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Direct child writes bypassed parent'; END IF;
  UPDATE public.call_reports SET intelligence='{"competitors":[],"barriers":[]}'::jsonb WHERE id=rid;
  IF EXISTS(SELECT 1 FROM public.report_competitors WHERE report_id=rid) OR EXISTS(SELECT 1 FROM public.report_barriers WHERE report_id=rid) THEN RAISE EXCEPTION 'Removal projection failed'; END IF;
  UPDATE public.call_reports SET status='approved' WHERE id=rid;
  IF (SELECT call_datetime FROM public.call_reports WHERE id=rid) IS NOT NULL THEN RAISE EXCEPTION 'Unknown time invented'; END IF;
  blocked:=false;
  BEGIN UPDATE public.call_reports SET intelligence=payload WHERE id=rid;
  EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Approved intelligence editable'; END IF;
  blocked:=false;
  BEGIN UPDATE public.call_reports SET ai_intelligence=payload WHERE id=rid;
  EXCEPTION WHEN raise_exception THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Provenance editable'; END IF;
  passed:=true;
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Rollback successful fixtures';
 EXCEPTION WHEN no_data_found THEN IF NOT passed THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: optional date-only approval, atomic projection/audit, invalid update rollback, identity confirmation, direct child write guard, removal projection, approved lock, immutable provenance; fixtures rolled back';
END $$;