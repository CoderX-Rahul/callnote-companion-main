# Phase 1 verification

## Delivered
- Case-insensitive partial doctor search across name, specialty, clinic and city, including ambiguous results and manual override. Existing master IDs remain authoritative; resolved doctor warnings disappear. Original mentions are saved for new drafts, and older drafts retain their original notes.
- Version 1.0.0 glossary contains all nine specified terms. Conservative sentence-local USB → USP normalization requires product-differentiation context and is suppressed by hardware context. No extra AI request is made. Original notes, normalized extraction input and glossary version are stored separately and immutable.
- Valid call dates allow approval with null exact time. Separate date/time controls, shared validation, server saves and atomic database approval/audit handling agree. Invalid dates/times are rejected. Existing timestamp reports remain compatible.
- Date-only reports display with “time unknown” in review and history, remain included in date filters and export with a call_date_only column. Dashboard created-at dates remain unchanged.

## Checks executed
- All 43 tests across four files passed; latest preview build is OK.
- Applied additive migration `drizzle/migrations/0004_phase1_reporting_intelligence.sql`; verified all three provenance columns exist in the live database.
- Transactional database assertions ran without error: date-only approval, null time, date-change audit and approved-content lock. Fixtures rolled back.
- Signed-in end-to-end flow with fictional note: real AI extraction, all four doctor search fields, manual replacement, save/readback, original/normalized text and mention preservation, approval without a time, approved readback, doctor audit, matching history date filters and CSV download. No browser page errors.
- Viewed phone and desktop screenshots; date-only approved reports and optional-time approval controls rendered correctly.
- Removed only the new end-to-end verification report afterward; existing records were not changed.

## Changed files
- Added `src/lib/doctor-search.ts`, `src/lib/pharma-glossary.ts`, `src/components/DoctorSelection.tsx`.
- Updated `src/lib/report-rules.ts`, `src/lib/ai.server.ts`, `src/lib/reports.functions.ts`, `src/routes/_authenticated/review.$id.tsx`.
- Added `src/test/phase1-intelligence.test.ts`, `src/test/phase1-audit.integration.sql`; extended `src/test/report-rules.test.ts`.
- Added the migration above; database types regenerated automatically. Updated `AGENTS.md` and `roadmap.md`.

## Limits and stop point
- Normalization is deliberately conservative; ambiguous USB references are left unchanged.
- Historical notes are not re-extracted or backfilled with glossary provenance.
- Phase 0 access safeguards remain intact. Phase 2 and higher are untouched.