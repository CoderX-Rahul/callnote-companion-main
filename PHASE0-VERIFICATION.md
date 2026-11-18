# Phase 0 verification

## Completed
- Restored public `/auth`; existing `/`, `/new`, `/history`, `/followups`, and review paths respond HTTP 200 and redirect signed-out visitors to sign-in, not 404.
- Enabled providers were confirmed: Google and Lovable.
- All ten report server functions validate bearer authentication and revalidate the confirmed approved identity through Auth before loading the privileged client.
- Database browser read grants remain revoked; RLS is enabled on all four application tables.
- Applied `drizzle/migrations/0003_phase0_atomic_report_audit.sql`: update trigger writes audits in the report update transaction, preserves original notes, locks approved content, validates required approval fields, and audits approval/follow-up changes.
- Draft saves compare the previous update timestamp and status to reject stale writes.
- CSV cells neutralize formula prefixes, including leading whitespace/control characters, while retaining CSV escaping.
- Added sign-out with protected query cancellation and cache clearing; one root identity-event listener invalidates routes.
- Existing page appearance and records preserved. No Phase 1 changes.

## Checks executed
- `bunx vitest run`: 24 tests passed across three files.
- Real database integration assertions: successful update/audit consistency, audit rollback on failed update, immutable original notes, required approval fields, approved report lock, follow-up audit. Completed without exception; fixtures rolled back and zero fixture rows verified afterward. Reusable script: `src/test/report-audit.integration.sql`.
- Live browser: all six paths above reached sign-in without 404, mobile screenshot inspected, no page errors.
- Live browser: all ten server functions rejected unauthenticated calls through their actual framework RPC stubs.
- Latest automatic build/typecheck: build OK.
- Database linter: four informational RLS-enabled/no-policy findings, intentional because direct browser table access is prohibited; no critical findings returned.
- Earlier targeted configuration-history inspection found public keys only, no private credentials. No additional full-history scan was claimed in this resumption.

## Remaining blocker (resolved)
Resolved after this report: the authorized demo account signed in with Google, and Phase 0 was confirmed by the user (see `roadmap.md`). Single-email authorization has since been replaced by verified MR profiles (Phase 4A); this section is kept only as history.

## Changed files
- Legacy prototype authorization (superseded by verified MR profile scoping in Phase 4A), `src/lib/reports.functions.ts`, `src/lib/report-rules.ts`
- `src/routes/auth.tsx`, `src/routes/__root.tsx`, all five existing content routes (leaf metadata)
- `src/components/AppShell.tsx`
- Auth and scoping coverage (now maintained in `src/test/mr-auth.test.ts` and `src/test/scoping.test.ts`), `src/test/report-rules.test.ts`, `src/test/app-routing.test.tsx`, `src/test/report-audit.integration.sql`
- Applied migration above and generated database types; provider-managed integration files if regenerated
- `AGENTS.md`, `roadmap.md`, this report
