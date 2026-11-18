-- LOCAL DEV SEED TEMPLATE. Not a migration. The local app shares the hosted app's backend.
-- Replace every <placeholder>. Never commit real ids. Create pre-confirmed auth users manually first.
-- Insert top-down so each reports_to subselect finds an existing profile.
-- 0. Find the demo organization id:
select id, name from public.organizations;

-- 1. Main organization reporting chain.
insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<NSM_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev National Sales Manager', 'DEV-NSM', 'nsm', null, true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<ZSM_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev Zonal Sales Manager', 'DEV-ZSM', 'zsm',
  (select id from public.mr_profiles where employee_code = 'DEV-NSM' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<RSM_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev Regional Sales Manager', 'DEV-RSM', 'rsm',
  (select id from public.mr_profiles where employee_code = 'DEV-ZSM' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<ASM_A_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev Area Sales Manager A', 'DEV-ASM-A', 'asm',
  (select id from public.mr_profiles where employee_code = 'DEV-RSM' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<ASM_B_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev Area Sales Manager B', 'DEV-ASM-B', 'asm',
  (select id from public.mr_profiles where employee_code = 'DEV-RSM' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<MR_A1_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev MR A1', 'DEV-MR-A1', 'mr',
  (select id from public.mr_profiles where employee_code = 'DEV-ASM-A' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<MR_A2_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev MR A2', 'DEV-MR-A2', 'mr',
  (select id from public.mr_profiles where employee_code = 'DEV-ASM-A' and organization_id = '<DEMO_ORG_ID>'), true);

insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
values ('<MR_B1_AUTH_USER_ID>', '<DEMO_ORG_ID>', 'Dev MR B1', 'DEV-MR-B1', 'mr',
  (select id from public.mr_profiles where employee_code = 'DEV-ASM-B' and organization_id = '<DEMO_ORG_ID>'), true);

-- 2. Optional second organization and MR for cross-organization isolation tests.
-- The local seed-dev-users.mjs script provisions this profile automatically.
-- For manual setup, create a pre-confirmed local Auth user first.
-- insert into public.organizations (name) values ('Dev Org B') returning id;  -- use the result as <DEV_ORG_B_ID>
-- insert into public.mr_profiles (user_id, organization_id, full_name, employee_code, role, reports_to, active)
-- values ('<ORG_B_MR_AUTH_USER_ID>', '<DEV_ORG_B_ID>', 'Dev MR Org B', 'DEV-ORGB-MR', 'mr', null, true);

-- 3. Inactive-profile test (restore active=true when finished).
-- update public.mr_profiles set active = false where employee_code = 'DEV-MR-A2';

-- 4. Verify profile hierarchy and organization boundaries.
select child.employee_code, child.role, child.organization_id, parent.employee_code as reports_to_employee_code
from public.mr_profiles as child
left join public.mr_profiles as parent
  on parent.id = child.reports_to and parent.organization_id = child.organization_id
where child.employee_code like 'DEV-%'
order by child.organization_id, child.employee_code;

-- 5. CLEANUP when finished (the live demo backend is shared with the hosted app):
--    delete from public.call_reports where mr_profile_id in (select id from public.mr_profiles where employee_code like 'DEV-%');
--    delete from public.mr_profiles where employee_code like 'DEV-%';
--    delete from public.organizations where name = 'Dev Org B';
--    then delete the test auth users in the backend Users screen.
