-- Read-only schema assertions for Phase 4A hardening, hierarchy, and soft delete.
DO $$
DECLARE
  target_table_name text;
  role_name text;
  privilege_name text;
  constraint_definition text;
  relation_acl_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols WHERE cols.table_schema = 'public' AND cols.table_name = 'call_reports' AND cols.column_name = 'deleted_at')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols WHERE cols.table_schema = 'public' AND cols.table_name = 'call_reports' AND cols.column_name = 'deleted_by') THEN
    RAISE EXCEPTION 'FAIL: soft-delete columns are missing.';
  END IF;

  FOREACH target_table_name IN ARRAY ARRAY[
    'organizations', 'mr_profiles', 'call_reports', 'report_edits', 'ai_draft_requests',
    'report_competitors', 'report_barriers', 'report_samples', 'report_collateral', 'report_commitments',
    'report_pob_items', 'product_schemes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target_table_name AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'FAIL: RLS is not enabled on public.%', target_table_name; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(role_name, 'public.' || target_table_name, privilege_name) THEN
          RAISE EXCEPTION 'FAIL: % has % on public.%', role_name, privilege_name, target_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH target_table_name IN ARRAY ARRAY['product_schemes','report_pob_items'] LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=target_table_name) THEN
      RAISE EXCEPTION 'FAIL: public.% unexpectedly has a browser policy.', target_table_name;
    END IF;
    IF NOT has_table_privilege('service_role','public.' || target_table_name,'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'FAIL: service_role is missing access to public.%', target_table_name;
    END IF;
    SELECT count(*) INTO relation_acl_count FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid=('public.' || target_table_name)::regclass AND acl.grantee=0;
    IF relation_acl_count<>0 THEN RAISE EXCEPTION 'FAIL: PUBLIC retains privileges on public.%', target_table_name; END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role','public.pob_monthly_totals(uuid,uuid[],date,date)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute the monthly POB function.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO constraint_definition
  FROM pg_constraint WHERE conrelid = 'public.mr_profiles'::regclass AND conname = 'mr_profiles_role_check';
  IF constraint_definition IS NULL OR NOT (
    constraint_definition LIKE '%mr%' AND constraint_definition LIKE '%asm%' AND constraint_definition LIKE '%rsm%'
    AND constraint_definition LIKE '%zsm%' AND constraint_definition LIKE '%nsm%'
    AND constraint_definition LIKE '%manager%' AND constraint_definition LIKE '%admin%'
  ) THEN RAISE EXCEPTION 'FAIL: mr_profiles role CHECK is missing a supported role.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mr_profiles'::regclass
      AND conname = 'mr_profiles_reports_to_organization_fkey'
      AND pg_get_constraintdef(oid) LIKE '%FOREIGN KEY (reports_to, organization_id)%'
  ) THEN RAISE EXCEPTION 'FAIL: reports_to composite foreign key is missing.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.mr_profiles'::regclass AND tgname = 'validate_mr_reporting_hierarchy' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: hierarchy validation trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'project_report_intelligence' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: intelligence projection trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'project_report_effectiveness' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: effectiveness projection trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'call_reports_soft_delete_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: soft-delete guard trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'call_reports_hard_delete_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: hard-delete guard trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'z_call_reports_client_draft_id_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: client draft key immutability trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'a_validate_report_pob' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'project_report_pob' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.call_reports'::regclass AND tgname = 'z_increment_pob_edit_count' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.report_pob_items'::regclass AND tgname = 'guard_pob_projection' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: POB validation, projection or direct-write guard trigger is missing.';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(role_name, 'public.validate_mr_reporting_hierarchy()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.audit_report_update()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.validate_report_intelligence()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.guard_intelligence_projection()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.project_report_intelligence()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.validate_report_effectiveness()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.project_report_effectiveness()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.guard_call_report_soft_delete()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.audit_call_report_soft_delete()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.guard_call_report_hard_delete()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.guard_call_report_client_draft_id()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.validate_report_pob()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.project_report_pob()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.increment_pob_edit_count()', 'EXECUTE')
      OR has_function_privilege(role_name, 'public.pob_monthly_totals(uuid,uuid[],date,date)', 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: browser role % can execute a protected trigger function.', role_name;
    END IF;
  END LOOP;
END;
$$;
