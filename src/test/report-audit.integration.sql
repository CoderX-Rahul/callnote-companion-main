-- Run through the privileged data tool. The enclosing subtransaction rolls back
-- every fixture and audit entry, including on assertion failure.
DO $$
DECLARE rid uuid; n integer; passed boolean := false; blocked boolean;
BEGIN
  BEGIN
    INSERT INTO public.call_reports(original_note) VALUES ('Phase 0 transactional security fixture') RETURNING id INTO rid;
    UPDATE public.call_reports SET purpose='Detailing' WHERE id=rid;
    IF (SELECT edit_count FROM public.call_reports WHERE id=rid) <> 1 OR
       NOT EXISTS (SELECT 1 FROM public.report_edits WHERE report_id=rid AND field='purpose' AND new_value='Detailing') THEN
      RAISE EXCEPTION 'Successful update/audit consistency failed';
    END IF;
    SELECT count(*) INTO n FROM public.report_edits WHERE report_id=rid;
    blocked := false;
    BEGIN
      UPDATE public.call_reports SET purpose='Must roll back', rep_name=NULL WHERE id=rid;
    EXCEPTION WHEN not_null_violation THEN blocked := true;
    END;
    IF NOT blocked OR (SELECT purpose FROM public.call_reports WHERE id=rid) <> 'Detailing' OR
       (SELECT count(*) FROM public.report_edits WHERE report_id=rid) <> n THEN
      RAISE EXCEPTION 'Failed update did not roll back its audit';
    END IF;
    blocked := false;
    BEGIN UPDATE public.call_reports SET original_note='Changed' WHERE id=rid;
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Original note was editable'; END IF;
    blocked := false;
    BEGIN UPDATE public.call_reports SET status='approved' WHERE id=rid;
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Incomplete report approved'; END IF;
    UPDATE public.call_reports SET doctor_id='DR-1001',call_datetime='2026-10-31 11:15+05:30',
      product_ids=ARRAY['PR-201'],follow_up_action='Send summary',status='approved' WHERE id=rid;
    blocked := false;
    BEGIN UPDATE public.call_reports SET purpose='Illegal edit' WHERE id=rid;
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Approved report was editable'; END IF;
    UPDATE public.call_reports SET follow_up_done=true WHERE id=rid;
    IF NOT EXISTS (SELECT 1 FROM public.report_edits WHERE report_id=rid AND field='follow_up_done' AND old_value='false' AND new_value='true') THEN
      RAISE EXCEPTION 'Follow-up audit missing';
    END IF;
    passed := true;
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Roll back successful test fixtures';
  EXCEPTION WHEN no_data_found THEN
    IF NOT passed THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: update/audit consistency, failure rollback, immutable notes, required approval fields, approved lock, follow-up audit; all fixtures rolled back';
END $$;