DO $$
DECLARE rid uuid; passed boolean := false; blocked boolean;
BEGIN
  BEGIN
    INSERT INTO public.call_reports(original_note, normalized_note, glossary_version, original_doctor_mention)
      VALUES ('Discussed USB for product differentiation with Dr. Sharma.', 'Discussed USP for product differentiation with Dr. Sharma.', '1.0.0', 'Dr. Sharma') RETURNING id INTO rid;
    UPDATE public.call_reports SET doctor_id='DR-1001', call_date_only='2026-10-31', product_ids=ARRAY['PR-201'], purpose='Detailing' WHERE id=rid;
    IF NOT EXISTS (SELECT 1 FROM public.report_edits WHERE report_id=rid AND field='call_date_only' AND new_value='2026-10-31') THEN RAISE EXCEPTION 'Date edit audit missing'; END IF;
    UPDATE public.call_reports SET status='approved' WHERE id=rid;
    IF NOT EXISTS (SELECT 1 FROM public.call_reports WHERE id=rid AND status='approved' AND call_datetime IS NULL AND call_date_only='2026-10-31') THEN RAISE EXCEPTION 'Date-only approval failed'; END IF;
    blocked := false;
    BEGIN UPDATE public.call_reports SET call_date_only='2026-11-01' WHERE id=rid;
    EXCEPTION WHEN raise_exception THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Approved date was editable'; END IF;
    passed := true;
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Roll back fixtures';
  EXCEPTION WHEN no_data_found THEN IF NOT passed THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: date-only approval, null time, date audit and approved lock; fixtures rolled back';
END $$;