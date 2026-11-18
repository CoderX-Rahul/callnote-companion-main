-- Requires the DEV-NSM through DEV-MR-B1 hierarchy and optional DEV-ORGB-MR fixture
-- from local-dev-seed.template.sql. Run manually only in a disposable transaction.
BEGIN;

DO $$
DECLARE
  nsm_id uuid;
  zsm_id uuid;
  rsm_id uuid;
  asm_a_id uuid;
  asm_b_id uuid;
  mr_a1_id uuid;
  mr_a2_id uuid;
  mr_b1_id uuid;
  org_b_mr_id uuid;
  org_a_id uuid;
  org_b_id uuid;
BEGIN
  SELECT id, organization_id INTO nsm_id, org_a_id FROM public.mr_profiles WHERE employee_code = 'DEV-NSM';
  SELECT id INTO zsm_id FROM public.mr_profiles WHERE employee_code = 'DEV-ZSM';
  SELECT id INTO rsm_id FROM public.mr_profiles WHERE employee_code = 'DEV-RSM';
  SELECT id INTO asm_a_id FROM public.mr_profiles WHERE employee_code = 'DEV-ASM-A';
  SELECT id INTO asm_b_id FROM public.mr_profiles WHERE employee_code = 'DEV-ASM-B';
  SELECT id INTO mr_a1_id FROM public.mr_profiles WHERE employee_code = 'DEV-MR-A1';
  SELECT id INTO mr_a2_id FROM public.mr_profiles WHERE employee_code = 'DEV-MR-A2';
  SELECT id, organization_id INTO org_b_mr_id, org_b_id FROM public.mr_profiles WHERE employee_code = 'DEV-ORGB-MR';

  IF nsm_id IS NULL OR zsm_id IS NULL OR rsm_id IS NULL OR asm_a_id IS NULL OR asm_b_id IS NULL OR
     mr_a1_id IS NULL OR mr_a2_id IS NULL OR org_b_mr_id IS NULL OR org_a_id = org_b_id THEN
    RAISE EXCEPTION 'Hierarchy integration test requires all documented DEV profiles in two organizations.';
  END IF;
  SELECT id INTO mr_b1_id FROM public.mr_profiles WHERE employee_code = 'DEV-MR-B1';
  IF mr_b1_id IS NULL THEN RAISE EXCEPTION 'Missing DEV-MR-B1 fixture.'; END IF;

  -- A complete valid chain (and the direct MR -> ASM link) remains accepted.
  UPDATE public.mr_profiles SET reports_to = NULL WHERE id = nsm_id;
  UPDATE public.mr_profiles SET reports_to = nsm_id WHERE id = zsm_id;
  UPDATE public.mr_profiles SET reports_to = zsm_id WHERE id = rsm_id;
  UPDATE public.mr_profiles SET reports_to = rsm_id WHERE id IN (asm_a_id, asm_b_id);
  UPDATE public.mr_profiles SET reports_to = asm_a_id WHERE id = mr_a1_id;
  UPDATE public.mr_profiles SET reports_to = asm_a_id WHERE id = mr_a2_id;
  UPDATE public.mr_profiles SET reports_to = asm_b_id WHERE id = mr_b1_id;
  IF (SELECT reports_to FROM public.mr_profiles WHERE id = mr_a1_id) IS DISTINCT FROM asm_a_id THEN
    RAISE EXCEPTION 'A valid MR -> ASM link was not stored.';
  END IF;

  -- Cross-organization, equal-rank and lower-rank parents are rejected.
  BEGIN
    UPDATE public.mr_profiles SET reports_to = org_b_mr_id WHERE id = mr_a1_id;
    RAISE EXCEPTION 'Expected cross-organization parent rejection.';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.mr_profiles SET reports_to = mr_a2_id WHERE id = mr_a1_id;
    RAISE EXCEPTION 'Expected equal-rank parent rejection.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.mr_profiles SET reports_to = mr_a1_id WHERE id = asm_a_id;
    RAISE EXCEPTION 'Expected lower-rank parent rejection.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A manager/admin role cannot be used as a parent.
  UPDATE public.mr_profiles SET reports_to = NULL WHERE id = mr_b1_id;
  UPDATE public.mr_profiles SET reports_to = NULL, role = 'admin' WHERE id = asm_b_id;
  BEGIN
    UPDATE public.mr_profiles SET reports_to = asm_b_id WHERE id = mr_b1_id;
    RAISE EXCEPTION 'Expected administrative parent rejection.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.mr_profiles SET role = 'asm', reports_to = zsm_id WHERE id = asm_b_id;
  UPDATE public.mr_profiles SET reports_to = asm_b_id WHERE id = mr_b1_id;

  -- NSM is the top of the chain and cannot have a parent.
  BEGIN
    UPDATE public.mr_profiles SET reports_to = zsm_id WHERE id = nsm_id;
    RAISE EXCEPTION 'Expected NSM parent rejection.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A role change that would put a direct child at the same rank is rejected.
  BEGIN
    UPDATE public.mr_profiles SET role = 'asm' WHERE id = rsm_id;
    RAISE EXCEPTION 'Expected role-change rejection for existing children.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
