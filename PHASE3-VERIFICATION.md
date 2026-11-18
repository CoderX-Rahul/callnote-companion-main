# Phase 3 verification — Field effectiveness

Scope: optional sample, collateral, conversion-commitment and HCP tier/access tracking. Approval rules unchanged; Phase 4 not started.

## What was added

- **Sample tracking**: multiple products per report, matched against the product master list; quantity is a non-negative integer or null when unstated (never estimated); distribution status distinguishes Distributed / Planned / Unknown; verbatim evidence from the original note.
- **Collateral tracking**: six standard material types (clinical trial reprint, product information brochure, reminder card, dosage chart, approved educational material, other), multiple per report, optional detail.
- **Conversion commitments**: commitment date, trial patient count (non-negative or null), status distinguishing Doctor commitment / MR follow-up / Confirmed product trial / Prescription conversion / Unknown, and follow-up outcome. A commitment is never treated as a prescription; no ROI or conversion claims are derived from sample counts.
- **HCP tier and access quality**: kept separate. Tier (A/B/C/Unclassified) is recorded only when the note explicitly states it — the AI never infers or permanently assigns a tier. Access quality: detailed face-to-face / brief / clinic assistant only / no access / unknown.
- All new fields are optional and never block approval; the original note, correction history and immutable AI extraction snapshot are preserved.

## Files changed

- `src/lib/report-effectiveness.ts` (new) — shared constants, schemas, normalization and validation (client-safe).
- `src/lib/ai.server.ts` — extraction schema and prompt extended with samples, collateral, commitments, tier and access quality; strict no-fabrication rules.
- `src/lib/reports.functions.ts` — draft creation stores normalized effectiveness + immutable snapshot; save validates effectiveness (known products, non-negative quantities, valid dates).
- `src/components/ReportEffectiveness.tsx` (new) — editable draft section and read-only approved view.
- `src/routes/_authenticated/review.$id.tsx` — effectiveness section in draft and approved views, plus original-extraction readback.
- `src/test/phase3-effectiveness.test.ts` (new) — 11 synthetic tests.
- `src/test/phase3-audit.integration.sql` (new) — transactional database checks.
- Migrations: `0007_phase3_field_effectiveness.sql` (effectiveness document + snapshot columns, three normalized child tables with checks, validation/projection/guard triggers, audit trigger counts effectiveness changes), `0008_phase3_revoke_browser_effectiveness_grants.sql` (new tables not readable from the browser).

## Checks run

- `bunx vitest run`: 63 tests pass across 6 files (11 new Phase 3 tests: multiple samples, null/negative/fractional quantities, invented-mention rejection, multiple collateral, commitment vs prescription distinction, evidence-gated status/outcome, explicit-only tier, tier/access separation, empty historical readback, save validation).
- Database integration SQL (rolled back, no lasting data): empty effectiveness projects no rows; update projects sample/collateral/commitment rows and writes an audit entry atomically; negative quantity rejected with full rollback; direct child-table writes rejected; invalid tier rejected; date-only approval with null time succeeds; approved effectiveness locked; AI snapshot immutable.
- Browser grants verified revoked on all three new tables (anon/authenticated read: false).
- Signed-in end-to-end (mobile viewport): note with two sample products, two collateral items, one commitment, stated tier and access quality → AI draft extracted all correctly → approved with unknown time → approved readback shows tier, access quality, collateral, commitment and "time unknown". No page errors.

## Remaining limitations

- AI extraction varies between runs; required fields left unconfirmed must be picked manually in review (by design — the AI never guesses).
- Territory/representative reporting is prepared for (normalized child tables) but no reporting UI exists yet.
- One fictional approved verification report remains in the demo data (identifiable by its Phase 3 note).
