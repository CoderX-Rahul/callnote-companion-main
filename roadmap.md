# Phase 0: Security and foundation

- [x] Inspect privileged access, audit consistency, CSV safety, and targeted tracked configuration history.
- [x] Confirm the original single-account access approach before it was replaced by verified MR profiles in Phase 4A.
- [x] Repair the sign-in transition and verify every existing signed-out page without 404 errors.
- [x] Implement Phase 0 corrections only, preserving all existing data and screens.
- [x] Run focused tests: 24 pass; live database atomicity assertions pass; all ten signed-out report calls rejected.
- [x] Phase 0 fully verified and locked down, confirmed by the user.
- [x] Report changed files, migration, checks, and remaining limitations in PHASE0-VERIFICATION.md; stopped before Phase 1.

# Phase 1: Reporting intelligence

- [x] Add searchable doctor selection, manual override and resolved warning handling.
- [x] Add version-controlled deterministic glossary with preserved original/normalized notes.
- [x] Allow date-only approval consistently in UI, server, database, history and CSV.
- [x] Run focused regression, database and signed-in end-to-end checks: 43 tests pass; stopped before Phase 2.

# Phase 2: Competitor and prescribing intelligence

- [x] Inspect schema and extend the existing single extraction request with optional, evidence-backed intelligence.
- [x] Add normalized storage with atomic audit, approved locks and identity confirmation.
- [x] Add editable competitor/barrier review and approved readback without changing required approval fields.
- [x] Run synthetic, regression, database and signed-in flow checks: 52 tests pass; database rollback assertions and signed-in extraction/edit/approval/readback pass. Details in PHASE2-VERIFICATION.md; stopped before Phase 3.

# Phase 3: Field effectiveness

- [x] Add optional sample tracking (multiple products, non-negative or null quantities, distributed vs planned).
- [x] Add optional collateral tracking (six standard material types, multiple per report).
- [x] Add optional conversion commitments (date, trial patient count, status, follow-up outcome; commitment never equals prescription; no ROI claims).
- [x] Add separate HCP tier (A/B/C/Unclassified) and access quality fields; AI records only explicitly stated tiers, never assigns.
- [x] Extend the single AI extraction request, schema, atomic audit/projection triggers and review UI; keep approval rules unchanged.
- [x] Add synthetic and database tests; run regression, database and signed-in end-to-end checks: 63 tests pass; database rollback assertions and signed-in extraction/approval/readback pass. Details in PHASE3-VERIFICATION.md; stopped before Phase 4.

# Phase 4A: Authenticated MR identity and ownership

- [x] Add organizations + mr_profiles tables; seed demo org/profile; backfill report ownership (additive migration `0009`).
- [x] Replace single-email authorization with verified-session profile resolution (`requireMrProfile`/`resolveMrProfile`); reject missing/inactive profiles.
- [x] Scope all report reads/writes/exports by ownership (MR: own; manager/admin: organization); set ownership server-side.
- [x] Show real MR profile on the dashboard; remove blanket "all fictional" claim, keep sample-data labeling.
- [x] Hardening migration `0010`: revoke browser-role grants on `organizations`/`mr_profiles`; record `actor_user_id` on intelligence/effectiveness audit rows.
- [x] Evidence hardening: minimum quote length; unverified evidence now also resets sample quantity, commitment date and trial patient count.
- [x] IST date boundary for dashboard/follow-ups/CSV filename; CSV ordered by call date with Phase 2/3 columns.
- [x] Add `src/test/scoping.test.ts` (two MRs, same-org and cross-org isolation, inactive/unprovisioned rejection, source guard) and `src/test/phase4a-hardening.test.ts`.
- [x] Apply the additive migrations through `0012` to local Supabase; run ownership, hardening, soft-delete, read-only schema and hierarchy SQL integration files.
- [x] Run full Vitest, typecheck and guarded database-backed hierarchy isolation test (results in PHASE4A-VERIFICATION.md).
- [x] Run ESLint; it reports repository-wide errors. Git is unavailable, so pre-existing versus new lint findings cannot be separated.
- [ ] Complete browser checks for sign-in/read-only review/deleted-draft disappearance/CSV spreadsheet behavior; run production build.
- [ ] Complete the Phase 4A Git checkpoint and final commit; Git for Windows is unavailable in this shell. Do not mark Phase 4A complete until the remaining items are verified.

# Phase 4A-2: Five-role sales hierarchy and scoped access

- [x] Add migration `0011` with role constraints, same-organization `reports_to`, rank validation, role-change checks, and browser grant revocation.
- [x] Compute MR/ASM/RSM/ZSM subtree reads server-side; NSM/admin/legacy manager retain organization reads; unknown roles fail closed.
- [x] Limit report edits, approval, draft deletion and follow-up completion to the report owner.
- [x] Add server-derived `can_edit`, read-only subordinate report views, report-owner labels, and dashboard role/scope labels.
- [x] Add hierarchy, cycle, tenant visibility, owner-write and source-guard tests; full suite: 138 passed. `tsc --noEmit`: 0 errors.
- [x] Replace the local profile seed template and document migration order, visibility matrix and history reassignment effect.
- [x] Apply migrations `0009` through `0012`; run `src/test/phase4a2-hierarchy.integration.sql` and the guarded `npm run test:db` PostgREST hierarchy test.
- [ ] Complete signed-in browser checks for MR/ASM/RSM/ZSM/NSM/admin/legacy-manager, cross-organization isolation and read-only UI behavior.

# Phase 4A-3: independent local and hosted backend options

- [x] Add `.env.local.example`, isolated local Supabase config, and local development/backend scripts without dependency changes.
- [x] Add target guards, journal-ordered migration runner, localhost-only `0009` auth-ID bootstrap, synthetic-user seeding and SQL fixture preflight.
- [x] Add optional OpenAI/Gemini-compatible AI configuration while preserving the existing default Lovable gateway behavior.
- [x] Apply local migrations, seed ten profiles, pass SQL integration files and the guarded PostgREST hierarchy test; run full Vitest and `tsc --noEmit` (current results in PHASE4A-VERIFICATION.md).
- [x] Verify local Supabase was running; use guarded migration, SQL, seed and test runners.
- [ ] Complete signed-in local browser checks and validate optional AI extraction configuration in the UI.
- [ ] For an owner-selected hosted backend, run guarded commands with `--allow-remote` and verify against that project.

## Phase 4A close-out status

Phase 4A remains **incomplete** on this machine: Git is unavailable, full ESLint reports errors, and browser-only checks/build were not run. See [PHASE4A-VERIFICATION.md](PHASE4A-VERIFICATION.md) for exact counts, lint summary, database state and outstanding sign-off items.

## Phase 4B: Idempotent drafts and Product Order Booking

- [x] Resume from the local journal through `0013`; no Part B files or migrations were present at resume. Apply additive POB migrations `0014`–`0019` through the local-target guard.
- [x] Add fictional MRP values and active free-goods/discount schemes; add canonical POB, immutable AI snapshot, validated projection, audit actor and approved-report locking.
- [x] Extend the existing extraction schema (version 2) with optional evidence-backed POB; use integer-paise calculations and server-side price/scheme recomputation.
- [x] Add owner-only POB review, read-only approved/non-owner review, month-selectable dashboard totals and manager roll-up, and appended protected CSV columns.
- [x] Add rollback SQL, POB calculation/normalization/roll-up/CSV tests, database-backed IST/month/scope tests, and idempotent fictional local demo reports.
- [x] Verify full Vitest, TypeScript, local SQL and database-backed Vitest suites; details and lint results are in [PHASE4A-VERIFICATION.md](PHASE4A-VERIFICATION.md).
- [ ] Complete the documented local browser/manual checks and create the Git checkpoint when the project is available as a repository.
- [x] Part C voice dictation adds optional browser speech input to the editable note; finalized segments only, manual review and submit.
- [ ] Complete manual microphone checks in supported browsers; browser testing remains outstanding.
