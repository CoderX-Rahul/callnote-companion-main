# Phase 4A close-out verification

## Status

Phase 4A is **not signed off** on this machine. The application and database checks passed, but the close-out gate remains open because Git is unavailable, ESLint reports repository errors, and browser/build checks were not run.

- [x] Apply migrations 0000–0012 to local Supabase in journal order.
- [x] Run SQL integration checks for ownership, hardening, soft delete, schema privileges and hierarchy.
- [x] Seed and verify ten local profiles across Org A and Dev Org B.
- [x] Run the guarded real-PostgREST hierarchy/isolation integration test.
- [x] Run full Vitest and tsc --noEmit.
- [x] Run ESLint and record its findings below.
- [ ] Git checkpoint, ignore verification and final commit.
- [ ] Browser sign-in/review/deletion/CSV checks and production build.

## Design and implementation

Migration 0012_phase4a_soft_delete is additive. It adds nullable deleted_at and deleted_by columns; permits a one-way soft delete only for an undeleted draft; requires deleted_by = updated_by; writes a report_edits row with the verified actor; blocks all updates after deletion; and rejects hard deletes unless the transaction sets app.allow_hard_delete to on locally. Test and maintenance cleanup use that escape hatch inside a transaction. No restore path was added.

scoped() and scopedOwn() apply deleted_at IS NULL, so report reads, owner writes, history, dashboard, follow-ups, direct review and CSV all exclude deleted rows. deleteDraft now performs an owner-scoped update. The generated Supabase type gap for the two additive columns is isolated in softDeleteReportQuery() in src/lib/mr-auth.ts.

The seed now provisions eight hierarchy profiles in Org A plus DEV-ADMIN and DEV-ORGB-MR in Dev Org B. A stale SQL-only Org B fixture had an Auth user ID that the local Auth API no longer recognized. The seed created a pre-confirmed local Org B account and rebound that one synthetic profile to it; its generated password was written only to ignored dev-users.local. The SQL fixture organization is named Dev Org B.

The local SQL runner registers a read-only schema audit and the rollback-only soft-delete integration file. It now rolls back a failed SQL test before trying the next file.

## Verification results

### Git and secrets

Git was not available (git was not recognized by PowerShell). Per the task instructions, I stopped the Git step: no git init, git add, status, ignore check, secret scan, checkpoint or commit was performed. No keys, passwords or connection strings were printed. Both package-lock.json and bun.lock exist.

### Local Supabase and migrations

Docker reported the local Supabase DB/API services up; the vector container was restarting. The guarded database scripts connected to the local loopback target. The runner showed each journal migration 0000 through 0011 recorded exactly once; migration 0012_phase4a_soft_delete was then applied. A subsequent query showed all thirteen migration tags exactly once.

npm run db:local:test-sql: 5 passed:

- phase4a-ownership.integration.sql
- phase4a-hardening.integration.sql
- phase4a-soft-delete.integration.sql
- phase4a-schema.integration.sql (read-only privilege/schema assertions)
- phase4a2-hierarchy.integration.sql

### Application tests and typecheck

- npm run test:db: 1 file, 2 tests passed. This uses a local-only target guard before Vitest, inserts one marker report per profile, checks hierarchy and tenant visibility through real PostgREST queries, verifies owner-only save/soft-delete/follow-up writes, checks deleted-row invisibility and cleans up through the transaction-local hard-delete escape hatch.
- npx vitest run: 11 files passed, 1 database-only file skipped; 153 tests passed, 2 skipped. The skipped tests run only through npm run test:db. The older Phase 4A-3 report recorded 148 passing tests; current normal-suite count is five higher.
- npx tsc --noEmit: passed with zero errors.

### ESLint

npm run lint was run and failed: 1,365 errors and 8 warnings across 111 files. The errors group by rule as 1,364 prettier/prettier and 1 @typescript-eslint/no-explicit-any; the 8 warnings are react-refresh/only-export-components.

Current lint findings in files touched during this close-out:
- scripts/local-db/local-utils.mjs: 17 prettier/prettier errors.
- scripts/local-db/seed-dev-users.mjs: 36 prettier/prettier errors.
- scripts/local-db/test-sql.mjs: 19 prettier/prettier errors.
- src/lib/mr-auth.ts: 17 prettier/prettier errors.
- src/lib/reports.functions.ts: 109 prettier/prettier errors.
- src/test/scoping.test.ts: 40 prettier/prettier errors.
- src/test/local-backend.test.ts: 10 prettier/prettier errors.
- src/test/ai-config.test.ts: 6 prettier/prettier errors and 1 @typescript-eslint/no-explicit-any error.
- New files scripts/local-db/test-db.mjs and src/test/hierarchy.integration.test.ts: no lint findings.

The remaining findings in touched files total 254 prettier/prettier errors and one no-explicit-any error. The full repository totals above include all 111 scanned files; without Git there is no reliable baseline comparison for untouched or previously modified work.

Without Git, I cannot compare these files with their Phase 4A baseline to identify pre-existing findings. The two newly added TypeScript/JavaScript test files are clean.

## AI resilience

Implementation adds configurable per-attempt timeout/retry/deadline limits, one wrapper retry layer with SDK retries set to zero, safe timing instrumentation, large-master prompt filtering, serializable failure results, a preserved-note Retry UI, and a localhost-only mock AI server. The server still validates the 5000-character note limit before extraction and does not insert a report after AI failure.

Verification performed for this change:

- `npx.cmd vitest run`: 11 files passed, 1 skipped; 181 tests passed, 2 skipped. Baseline before edits: 11 files passed, 1 skipped; 153 tests passed, 2 skipped.
- `npx.cmd tsc --noEmit`: passed with zero errors.
- `node --check scripts/dev/mock-ai-server.mjs`: passed. Started the mock server bound to 127.0.0.1 and sent local requests to `/400`, `/429`, `/429-no-header`, and `/500`; observed status codes 400, 429, 429, and 500, with Retry-After `2` only on `/429`.
- Focused Vitest tests exercise retry classification, jitter, retry limits, total deadline and master-list thresholds. ESLint on changed files reports: `ai.server.ts` 0 errors; `reports.functions.ts` 113 Prettier errors (the previous repository record was 109 for this file); `new.tsx` 0; `ai-config.test.ts` 1 pre-existing `no-explicit-any`; `mock-ai-server.mjs` 0. No warnings were reported.
- Not run: full browser flow against the mock, `/hang` or `/slow` timing, real AI provider requests, 5–10 real note extractions, production build, or Lovable Cloud requests. The verification above does not establish provider latency or mock-to-app behavior in a browser.

## Part A — Idempotent draft creation

Migration `0013_idempotent_ai_drafts` adds the profile-scoped request key and a partial unique report key. The new database request table is RLS-enabled, has no browser policies, and grants access only to `service_role`. A follow-up draft-key guard runs after the existing approved-row trigger; the rollback SQL test confirms that the existing whole-row comparison rejects changing this column on an approved report.

The server hashes the exact submitted note, claims before master-data loading/model work, and uses compare-and-set leases for failed retries and stale takeovers. Completion and failure updates carry the lease timestamp. The report insert remains a single write; a unique-key conflict fetches the existing owner-scoped live report. The browser holds/reuses a UUID v4 for the same note, rotates it for changed text and after success, and exposes manual `Check again` for in-progress requests.

Verification performed for Part A:

- Baseline before Part A: `npx.cmd vitest run` had 181 passed / 2 skipped; `npx.cmd tsc --noEmit` passed.
- `npx.cmd vitest run`: 12 files passed, 2 skipped; 194 tests passed, 3 skipped.
- `npx.cmd tsc --noEmit`: passed with zero errors.
- `npm.cmd run db:local:migrate`: applied `0013_idempotent_ai_drafts`; earlier journal entries were already recorded. The existing local-target guard ran.
- `npm.cmd run db:local:test-sql`: all 6 SQL files passed, including the new rollback idempotency assertions for per-MR keys, duplicate claims, report uniqueness, RLS/grants, draft-key immutability and approved locking.
- `npm.cmd run test:db`: 2 files passed, 3 tests passed, including the concurrent claim test (one winner, one in-progress result).
- Focused ESLint: `draft-idempotency.ts`, new idempotency tests, `new.tsx`, `local-backend.test.ts`, and `test-db.mjs` had 0 errors; `reports.functions.ts` had 101 Prettier errors (the prior repository record was 109); `test-sql.mjs` had 19 existing Prettier errors. No warnings were reported.
- Not run: browser/UI response-loss verification, the manual duplicate-note check, a real AI request/model-call count, production build, or any Lovable Cloud command. The exact manual check is: submit one note twice quickly; then submit it again, interrupt only the browser response while allowing the server operation to finish, restore the connection and retry the identical note. Confirm one report and one model attempt on a normal successful response.
- No commit was created: this supplied workspace has no `.git` directory. Git is installed at `C:\\Program Files\\Git\\cmd\\git.exe`, but this folder is not a repository; initializing a new repository would create unrelated history.

## Invariant review

- Evidence: tests cover the five-character minimum and verbatim matching. Missing/invalid evidence resets sample quantity, commitment date and trial patient count; the hardening tests cover these resets.
- IST: dashboard/follow-up calculations use todayIST()/addDays(). Remaining toISOString().slice(0, 10) hits are src/lib/report-rules.ts:46 (safeDate round-trip validation), src/lib/report-rules.ts:88 (addDays UTC arithmetic on a date-only value), and src/test/phase4a-hardening.test.ts:82 (a date assertion); none derives the current calendar day.
- CSV: report-export.ts sorts using effective calendar date, preserves the existing columns, appends Phase 2/3 columns, and handles date-only reports with null call time. Tests cover null-time ordering and flattened columns.
- Writes: saveReport scopes both its current-row read and update with scopedOwn; deleteDraft and setFollowUpDone also use scopedOwn, with live-row filtering. The review route renders ReadOnlyReportView when can_edit is false. Server filters enforce owner-only writes regardless of UI.
- Prototype references: the repository scan found no remaining legacy prototype auth symbols or deleted test references.

## Not run / developer-only checks

- No production build or browser session was run. The developer still needs to verify sign-in as each role, non-owner read-only review, deleted drafts disappearing after navigation, and the approved CSV opened in a spreadsheet.
- No hosted/Lovable Cloud database was contacted.
- Phase 4A remains incomplete until the Git checkpoint/final commit, lint findings and browser/build checks are resolved or explicitly accepted.

## Part B — Product Order Booking and monthly hierarchy roll-up

### Resume state and design

At Part B resume, the local migration journal and database both ended at `0013_idempotent_ai_drafts`. The application directory contained no `.git` directory, and POB implementation was absent. The schema is managed under `drizzle/migrations/` (there is no `supabase/migrations/` directory). Part B was implemented as additive migrations `0014`–`0019`; `0017` fixes multi-line approved-call counting, `0018` keeps `edit_count` aligned with POB audit entries, and `0019` stores free-unit counts as unknown when quantity/scheme resolution is unknown. Previously applied migrations were not edited.

The existing single AI extraction request now has an optional POB array and extraction schema version 2. Server normalization verifies evidence, validates master IDs, recomputes MRP/scheme snapshots with integer paise, and ignores browser-supplied stated-price values on save. Scheme matches require exactly one active date-valid product scheme. Missing/ambiguous schemes and stated-price/MRP mismatches remain visible as warnings. POB does not add an approval requirement.

The review page shows optional editable POB for an owner draft, and read-only POB for approved or non-owner reports. The dashboard uses the service-role-only monthly SQL function with verified profile scope and hierarchy data; the RPC filters approved, non-deleted reports and uses Asia/Kolkata call dates. It counts a report once even when it has multiple order lines. Approved CSV adds POB parallel-list columns after existing columns and retains CSV formula protection.

Local seed reports are fictional and marker-tagged `[FIELDIQ-POB-DEMO-2026-11:...]`. `npm run db:local:seed-pob` inserts them idempotently for `DEV-MR-A1` and `DEV-MR-A2`; it does not overwrite existing reports. The script and migration commands retain the local backend safety guard.

### Verification

- Part B baseline: `npx.cmd vitest run` had 194 passed / 3 skipped; `npx.cmd tsc --noEmit` passed. Local Supabase had migrations `0000`–`0013` recorded.
- `npm.cmd run db:local:migrate`: skipped recorded migrations `0000`–`0018` and applied `0019_pob_unknown_free_quantity`; `0014`–`0019` are recorded locally.
- `npx.cmd vitest run`: 13 files passed, 3 skipped; 202 tests passed, 4 skipped.
- `npx.cmd tsc --noEmit`: passed with zero errors.
- `npm.cmd run db:local:test-sql`: all 7 SQL integration files passed, including POB RLS/grants, projection validation, direct-write protection, evidence rejection, audit actor, edit counter, immutable AI snapshot, approved lock and monthly totals.
- `npm.cmd run test:db`: 3 files passed, 4 tests passed. The POB database test checks an IST month-boundary timestamp, tentative-order exclusion, organization scope, and call counting across multiple booked lines.
- `npm.cmd run db:local:seed-pob`: passed twice; second run kept the existing marker-tagged demo reports.
- `npm.cmd run lint`: failed with 1,352 errors and 8 warnings across the repository. The changed existing files with findings report Prettier errors: `reports.functions.ts` 123, `report-rules.ts` 7, `report-export.ts` 2, authenticated index 29, review route 50, and `scripts/local-db/test-sql.mjs` 19. `ai.server.ts`, `local-backend.test.ts`, `test-db.mjs`, and the new POB TypeScript/JavaScript files have no findings. The earlier Part A record had 101 findings in `reports.functions.ts`; without Git history, I cannot reliably classify the other current findings as pre-existing versus introduced.
- The `.env` files, tracked Supabase config, `src/integrations/**`, and `src/routeTree.gen.ts` were not edited. No hosted/Lovable Cloud or AI provider request was made.

### Manual local test script

1. Start the isolated local stack and run the guarded local setup: `npm run db:local:start`, `npm run db:local:env`, `npm run db:local:migrate`, `npm run db:local:seed`, `npm run db:local:seed-pob`, then `npm run dev:local`.
2. Sign in as `DEV-MR-A1`. On the dashboard, select November 2026 and confirm the POB value, booked calls, conversion denominator and average. Open the marker-tagged approved report and confirm its POB is read-only.
3. Create a draft with an explicit order quote such as: “Met Dr. Anita Sharma on 17 Nov 2026. Cardiovex 10 mg: booked 20 packs with 10+1 offer at Rs 125.” Confirm the AI extraction makes no inferred quantities or schemes; review the exact evidence, active scheme, free units, calculated value and any price warning. Edit/save as owner, then approve; repeat approval with no POB lines to confirm POB is optional.
4. As an ASM/RSM/ZSM/NSM account, switch months and confirm the direct-report roll-up; verify tentative lines do not count. As an unrelated MR, confirm own-only dashboard values and read-only subordinate review. Export approved CSV and verify the appended POB columns and formula-safe cells.
5. To remove only the demo rows during local maintenance, use this transaction only against the guarded local database:

   ```sql
   BEGIN;
   SELECT set_config('app.allow_hard_delete', 'on', true);
   DELETE FROM public.call_reports
   WHERE original_note LIKE '[FIELDIQ-POB-DEMO-2026-11:%';
   COMMIT;
   ```

### Stop point

Part B implementation and requested automated verification are complete. Browser/manual checks, production build and a real AI extraction were not run. Part C (voice dictation) has not started. No commit was created: the supplied project directory has no `.git` repository, so there is no repository history or commit target to update.


## Part C: Optional voice dictation

### Implementation

The new-report page feature-detects standard and WebKit-prefixed Web Speech API support. When available, the MR can start/stop `en-IN` dictation. Interim recognition is ignored; each final segment is appended to the existing editable note with a separating space when needed. The user remains responsible for reviewing and manually submitting the note. The app does not record or persist audio and dictation does not submit or call an AI model by itself. The UI notice explains that browser speech may send audio to the browser vendor and that microphone access needs HTTPS or localhost (not `http://192.168.x.x`).

### Verification

- Baseline before Part C: Vitest 13 files passed / 3 skipped; 202 tests passed / 4 skipped. `npx.cmd tsc --noEmit` passed.
- Added pure tests for transcript append spacing, empty segments, standard/prefixed feature detection, and unsupported environments.
- After Part C: Vitest 14 files passed / 3 skipped; 207 tests passed / 4 skipped. `npx.cmd tsc --noEmit` passed. ESLint on the three changed TypeScript files passed with no findings.
- Browser microphone testing has not been run; browser compatibility and the browser vendor's speech-service behavior remain unverified. No audio was captured and no AI/provider request was made for dictation.
