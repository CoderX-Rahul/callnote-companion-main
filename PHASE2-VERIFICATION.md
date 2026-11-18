# Phase 2 verification

## Delivered
- Optional multiple competitor entries with original mention, brand, master product match, confirmation state, sentiment, preference reason/detail and evidence.
- Optional multiple prescribing barriers with category, status, a single primary flag, evidence and stated follow-up action.
- The existing extraction request/model/provider remains in place. Intelligence is extracted in that same request, not a second AI request. Original text is supplied alongside normalized text for verbatim evidence validation.
- Unknown and ambiguous identities stay unresolved unless manually confirmed. Missing intelligence never becomes an approval requirement.
- Immutable initial AI intelligence snapshot, editable draft intelligence, and read-only approved intelligence.
- Normalized competitor/barrier relations projected transactionally from the parent report. Parent changes, relational projection and audit either succeed together or roll back together.
- Existing approved locks, preserved notes and optimistic concurrency remain; new child tables cannot be written directly.

## Changes
- `src/lib/report-intelligence.ts`: schemas, categories, deterministic evidence/identity normalization and validation.
- `src/lib/ai.server.ts`: optional structured extraction and instructions, unchanged model and endpoint.
- `src/lib/reports.functions.ts`: save/extraction persistence and stale-save check.
- `src/components/ReportIntelligence.tsx`: editable draft and approved readback.
- `src/routes/_authenticated/review.$id.tsx`: intelligence and original extraction sections.
- `src/test/phase2-intelligence.test.ts`: nine focused synthetic tests.
- `src/test/phase2-audit.integration.sql`: rollback-only integrity checks.
- `AGENTS.md`, `roadmap.md`, project controlled-development memory.
- Migration `0005_phase2_report_intelligence.sql`: optional parent document/snapshot, normalized relations, validation/projection/direct-write guard triggers and audit count extension.
- Migration `0006_phase2_revoke_browser_intelligence_grants.sql`: explicit revocation of inherited browser grants discovered during verification. Both new tables have RLS enabled and no anon/authenticated read privileges.
- Database-generated types updated by migration tooling.

## Executed checks
- `bunx vitest run`: **52 tests passed across five files**, including all Phase 0/1 regression tests.
- Synthetic cases: no competitor, one/multiple competitors, positive/negative/neutral/mixed/unknown sentiment, pricing/clinical preferences, uncertainty, rejected invented IDs/evidence, multiple barriers and optional approval.
- Live rollback-only SQL: optional date-only approval, atomic projection/audit, failed projection rollback, unconfirmed master match rejection, direct child-write rejection, removal projection, approved lock and immutable snapshot. No SQL fixture rows remain.
- Live schema checks confirmed the two new relations and parent fields actually exist; RLS and final browser-grant revocation verified.
- Signed-in phone-sized central flow: natural-language note → AI draft with three competitors/two barriers → change sentiment → Save → reload confirms change → approve with unknown exact time and unresolved optional competitor → approved readback. Parent and normalized counts agree (three competitors, two barriers); one intelligence edit audited.
- AI correctly returned Positive price preference, Mixed clinical/tolerability sentiment, Unknown uncertain identity, and price/clinical barriers in the observed request.
- Final signed-in readback as the authorized demo account: history loads, a historical report shows empty optional intelligence, and the Phase 2 report retains saved details.
- Screens checked at 469×748 and 1280×1800: no horizontal overflow; approved intelligence visibly renders. Initial central flow reported no page errors. Final build log: build OK.
- All existing content routes retain unique page metadata.

## Notes and boundaries
- One fictional approved verification report remains intentionally identifiable by “Fictional Phase 2 verification note.” Existing reports were not altered.
- Follow-up suggestions reflect only stated actions; no new task automation or separate prescribing recommendations were added.
- No competitor-specific master catalogue was invented; known product master IDs are reused when available and external brands remain text mentions.
- Phase 3 and higher were not implemented.