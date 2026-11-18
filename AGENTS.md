<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## FieldIQ Pharma decisions
- Every report server function is behind `requireMrProfile` (`src/lib/mr-auth.ts`): the verified Auth user id resolves to an active `mr_profiles` row, and the middleware computes the read scope from that stored profile. The service-role client bypasses RLS, so every `call_reports` read uses `scoped()` and every write uses `scopedOwn()` (owner only); both helpers filter `deleted_at IS NULL`. Inserts set `organization_id`/`mr_profile_id` from the profile. `src/test/scoping.test.ts` covers hierarchy isolation, live-row filtering and guards every report query. `organizations` and `mr_profiles` have RLS with no policy and no browser-role grants (`0009`, `0010`, `0011`); RLS and revoked browser grants keep data off direct browser queries.
- Audit actor: `report_edits.actor_user_id` is `call_reports.updated_by`, which the server sets from the verified user id on every write; the audit trigger and the intelligence/effectiveness projection triggers (`0010`) all record it.
- Evidence rule: AI-supplied evidence must be a verbatim quote of at least `MIN_EVIDENCE_CHARS` (5) characters from the original note (`verbatimEvidence` in `report-rules.ts`). Anything that depends on unverified evidence is reset to unknown/null, including sample quantities, commitment dates and trial patient counts, not only statuses.
- "Today" for overdue and due-soon logic is the Asia/Kolkata calendar date (`todayIST`, `addDays` in `report-rules.ts`); never derive it from `toISOString()`, which is UTC and lags IST between 00:00 and 05:30.
- Approved-report CSV is built by `src/lib/report-export.ts`: ordered by call date in code (SQL `ORDER BY call_datetime DESC` puts time-unknown reports first), original columns first, then flattened intelligence/effectiveness columns (parallel lists; `Unknown` = recorded but unstated, empty = nothing recorded). All cells pass through the formula-injection guard.
- AI extraction lives in `src/lib/ai.server.ts` (Lovable AI Gateway, Responses API, structured output). The server re-validates every AI-returned doctor/product ID against master data so the model can never introduce identities.
- Approval/validation rules are pure functions in `src/lib/report-rules.ts`, shared by UI and server and covered by `src/test/report-rules.test.ts`.
- A database BEFORE UPDATE trigger locks approved report content, preserves original notes, validates approval, and writes field/status/follow-up audit entries in the same transaction; server updates use optimistic concurrency to reject stale draft saves.
- Draft deletion is a soft delete under migration `0012`: only an undeleted draft can be marked deleted; deletion is audited with the verified `updated_by` actor. Deleted rows cannot be restored or edited and are filtered from all report queries. Hard DELETE is rejected unless a maintenance transaction runs `select set_config('app.allow_hard_delete', 'on', true)`; use this only for test/maintenance cleanup.
- The sole home route remains the gated index at `/`; public `/auth` completes OAuth before navigating home, avoiding duplicate root routes and sign-in refresh loops.
- Doctor selection uses client-safe deterministic search over existing master data; only selected master IDs are authoritative, preserving extraction provenance.
- Glossary definitions and normalization live in a versioned client-safe module; extraction stores normalized input and version alongside the immutable original note without additional AI calls.
- Call dates use call_date_only; call_datetime stays null when time is unknown. Shared validation and the atomic database trigger allow either valid date representation, keeping historical timestamp reports compatible.
- Optional intelligence uses a canonical report document and immutable AI snapshot; database triggers validate, project normalized competitor/barrier rows and audit changes atomically, so approval locks and optimistic concurrency cover every edit without multi-request writes.
- Competitor identity and evidence normalization is client-safe in report-intelligence; extraction extends the existing AI request, revalidates master IDs and preserves unresolved external identities without making intelligence an approval requirement.
- Optional field effectiveness (samples, collateral, commitments, HCP tier, access quality) follows the same canonical-document pattern as intelligence: client-safe normalization in report-effectiveness, an immutable AI snapshot, and database triggers that validate, project normalized child rows and audit changes atomically. Quantities and outcomes are never invented (unknown stays null), a commitment is never treated as a prescription, no ROI is derived from sample counts, and HCP tier is recorded only when explicitly stated — never auto-assigned.

## AI extraction resilience
- `AI_TIMEOUT_MS` is a per model attempt limit (default 45000, range 5000–120000); `AI_MAX_RETRIES` is the wrapper retry count (default 2, range 0–4); `AI_TOTAL_DEADLINE_MS` is the whole extraction budget (default 90000, range 10000–180000). Invalid values fall back to defaults and emit a timing log entry. These limits apply to both the Lovable gateway and `AI_*` override.
- Keep the AI SDK's `generateText({ maxRetries: 0 })`: `withAiRetry` is the only retry layer. It retries network failures, per-attempt timeouts, HTTP 408/429/500/502/503/504 and identifiable unparsable structured output (at most once). It does not retry other 4xx statuses, safety blocks, or business validation errors. Backoff uses full jitter from 1s exponential to 8s maximum. A Retry-After above the cap or remaining deadline ends as a rate-limit result; attempts do not start with less than 10s left.
- The note limit is enforced in the server input validator at 5000 characters. Do not rewrite note text: evidence remains checked against the original note. Master data is sent in full through 200 doctors / 100 products; above either threshold, prompt candidates are filtered by note tokens and capped at 120 doctors / 80 products, with up to 20 stable-order fallback entries. The full data remains available for server ID validation and doctor search.
- `AI_REASONING_EFFORT` is optional and unset by default. It maps to the OpenAI provider option `openai.reasoningEffort` on the override path only. The installed `@ai-sdk/openai` 4.0.110 declarations include this option.
- Safe development-only `[ai-timing]` logs include master-load, note normalization, prompt build, each model attempt, validation and full-request durations, attempt number, status class, note character count, and prompt character count. They never contain note text, master data or credentials. Set `AI_TIMING_LOGS=false` to turn them off. During 5–10 real extractions, compare the short, medium and roughly 4500-character notes: master-data time isolates Supabase loading, prompt-built shows prompt assembly and doctor/product payload sizes, model-attempt shows provider wait per try, and request-complete shows the total. Do not infer a latency target from one run.
- Failure-path testing uses `node scripts/dev/mock-ai-server.mjs 8787`, bound only to 127.0.0.1. In a local shell set `AI_BASE_URL=http://127.0.0.1:8787/<mode>`, `AI_API_KEY` to a dummy shell-only value, and `AI_MODEL` to a compatible model name; restart the dev server and submit a note. `/hang` and `/slow` each make up to two calls (one retry) and end around the 90s total deadline. `/429` makes up to three calls with two 2s Retry-After pauses (about 4s plus request time); `/429-no-header` uses at most two retries and up to 3s total jitter; `/500` uses at most two retries and up to 3s total jitter; `/400` makes one call without retry. If AI_TIMEOUT_MS/AI_MAX_RETRIES/AI_TOTAL_DEADLINE_MS are changed, timing changes accordingly. Each final failure should show a friendly message and leave the note in the textarea. The mock reads no environment values and is not imported by app code.

## Idempotent AI draft creation
- Migration `0013_idempotent_ai_drafts` assigns browser-generated UUID v4 keys to drafts. The client key is never a report ID or owner identifier. The server hashes the exact submitted note bytes; input validation must not trim or rewrite the submitted note before hashing or saving it.
- `ai_draft_requests` is keyed by `(mr_profile_id, client_draft_id)`, has RLS enabled and no policies, and is available only to `service_role`. A duplicate key for a different MR is independent. `call_reports` has a partial unique owner/key index; the ID key is immutable after insert.
- Claim before loading master data or calling AI. A matching `done` row returns its report; matching `processing` returns in-progress until `AI_TOTAL_DEADLINE_MS + 30000`, then uses compare-and-set takeover. A matching `failed` row can be claimed again. Hash mismatch returns `key_reuse_conflict`. Completion and failure updates are fenced by the claim's `updated_at` lease so an old worker cannot overwrite a newer claim.
- Only the lease winner calls `extractFromNote`. Its existing `withAiRetry` still wraps only the model call, with AI SDK retries set to zero. Database writes are not retried. A unique report-key conflict fetches the owner-scoped existing live report; no second report is inserted.
- The approved-report trigger compares the whole row and therefore includes `client_draft_id`; migration 0013 adds a later-running guard so the key also cannot change on a draft. Report audit actor, original note, and AI snapshot rules remain unchanged.
- The UI keeps a key for identical-note retries, selects a new key when submitted text changes and after success, preserves text on failure, and offers a manual `Check again` action while processing. It does not poll or automatically retry.
- Verify locally with `npm run db:local:migrate`, `npm run db:local:test-sql`, and `npm run test:db`; both database commands use the local-target safety guard. The manual response-loss check is: submit the same note twice quickly, then simulate loss of the browser response while allowing the server request to finish and retry the unchanged text. Confirm one report and one model extraction using `[ai-timing] model-attempt` logs.

## Local development
- `npm run dev` loads `.env.local` into the Node server process; `npm run dev:local` also checks the local backend target before starting. `/~oauth/initiate` is provided only by Lovable hosting, so use the developer password form on `localhost` or `127.0.0.1`.
- For local database development, use the isolated `fieldiq-local` Supabase stack. Keep fixture data clearly marked and never point local scripts at the tracked Lovable Cloud project.
- A sign-in user needs an active `mr_profiles` row. Use `src/test/local-dev-seed.template.sql` as a manual template after creating pre-confirmed auth users; never put credentials or real ids in the repository.
- Use separate browser profiles or incognito windows to hold MR and manager sessions at the same time. The app has a sign-out control in `AppShell`.
- MR A creates and approves a report: MR B must not see it in dashboard, history, follow-ups or CSV export; opening `/review/<id>` directly must fail.
- Manager sees MR A's and MR B's reports in dashboard counts, history, follow-ups and export, but sees nothing from Org B.
- Org B MR sees none of Org A's data; a direct `/review/<id>` of an Org A report must fail.
- A signed-in user without an `mr_profiles` row, and one with `active=false`, must both get the not-provisioned message and no data.
- Doctor and product master lists are global, not organization-scoped; all profiles see the same lists.
- Hierarchy managers have read-only access to reports owned by subordinates; only the report owner can edit, approve, delete a draft or mark a follow-up done.

## Product Order Booking (Part B)
- Migrations `0014`–`0019` are additive. `0014` adds fictional MRP/schemes, `0015` adds the immutable AI POB snapshot plus validated projection/audit, `0016` adds monthly IST totals, `0017` fixes distinct call counting for multi-line reports, `0018` counts POB edits in `edit_count`, and `0019` preserves unknown free-unit counts as null. Do not edit applied migrations.
- POB is optional and never an approval requirement. Extraction extends the existing single AI request; `EXTRACTION_SCHEMA_VERSION` is 2. Do not add a second model call for schemes, prices, totals or roll-up.
- AI/UI product and scheme IDs are revalidated against the master. Server code recomputes MRP snapshots, free units, discounts and line values with integer paise and half-up rounding. Save ignores browser-supplied price values and restores stated prices only from immutable `ai_pob` where the evidence and mention still match.
- POB numeric values and status require verbatim evidence of at least five characters. Missing or invalid evidence resets quantity, stated price and status. Unknown quantity or MRP means null line value. Tentative/Unknown lines do not count as booked.
- Scheme resolution requires one active, date-valid product scheme match. Keep unmatched and ambiguous schemes visible as warnings. Never infer a scheme from MRP or an order mention.
- `getPobSummary` is profile-gated, applies the report scope, and calls the service-role-only RPC with server-derived organization/profile IDs. Monthly calendar boundaries use Asia/Kolkata; only approved, non-deleted reports count. Preserve owner-only writes and read-only approved/non-owner UI.
- Approved CSV appends flattened parallel POB lists after existing columns. Keep formula-injection protection. POB projections are transactionally guarded and audit rows use `actor_user_id = updated_by`.
- Local demo reports are fictional, marker-tagged `[FIELDIQ-POB-DEMO-2026-11:...]`, and idempotently seeded by `npm run db:local:seed-pob`. Use only the local target guard; cleanup is limited to those marker rows in a local maintenance transaction.

## Phase 4A-2: five-role sales hierarchy
- Sales ranks are `mr < asm < rsm < zsm < nsm`; `admin` and legacy `manager` remain valid organization-wide readers outside the chain. `reports_to` may skip levels but must point to a strictly higher-ranked profile in the same organization.
- Read scope: MR and unknown roles see own reports; ASM/RSM/ZSM see their own reports plus every direct and indirect subordinate; NSM/admin/legacy manager see their organization. No role crosses organizations.
- Write scope: only the report owner may save/edit, approve, delete a draft or mark a follow-up done. Team and organization readers cannot write another profile's report.
- Apply migrations in journal order through `0012` before running the current app. Changing `reports_to` changes who can see an MR's entire report history.
- Manual matrix (all reports are limited to the caller's organization):

| Profile | Expected report visibility |
| --- | --- |
| MR-A1, MR-A2, MR-B1 | Own reports only |
| ASM-A | Own, MR-A1 and MR-A2; no ASM-B branch |
| ASM-B | Own and MR-B1 only |
| RSM | Own, both ASMs, and MR-A1/MR-A2/MR-B1 |
| ZSM | Own, RSM, both ASMs, and all five MRs |
| NSM, admin, legacy manager | Whole organization |
| Org-B MR | Own Org-B reports only; no Org-A data |
| Unrecognized role | Own reports only |

- Direct `/review/<id>` for any out-of-scope report fails. A signed-in user without a profile or with `active=false` sees the not-provisioned/inactive message and no data.
- Doctor and product master lists remain global. Use separate browser profiles to test simultaneous sessions; `AppShell` has sign-out. Seed fixtures are in `src/test/local-dev-seed.template.sql` and must be applied manually.

## Local backend (Phase 4A-3)
- `.env.local` overrides the tracked Lovable-managed `.env` locally. Copy `.env.local.example` to `.env.local`; keep values out of source control and never put server secrets in `VITE_*`. The local dev runner uses Node `--env-file=.env.local` because the Vite plugin only loads `VITE_*` variables.
- Docker option: install Docker and the Supabase CLI, then run `npm run db:local:start`, `npm run db:local:env`, `npm run db:local:migrate`, `npm run db:local:seed`, `npm run db:local:test-sql`, and `npm run dev:local`. Stop with `npm run db:local:stop`; `npm run db:local:stop -- --no-backup` resets the local database. The isolated config is `scripts/local-db/supabase/config.toml`; the root Lovable `supabase/config.toml` is not used or edited.
- Hosted option: set the owner-provided backend URL, publishable key, service role key, database URL and project id in `.env.local`. Every operation refuses the tracked Lovable URL/project ID. For a non-local target, pass `--allow-remote` explicitly to db env, migrate, seed and SQL test commands. Review the target yourself; these scripts never link, push, or log in to Supabase.
- `npm run db:local:migrate -- --dry-run` lists journal order without connecting. Normal migration application requires an isolated empty local project. The runner locally bootstraps the auth user ID referenced in migration `0009`; it creates no credential. Remote databases must already contain the migration prerequisite, and the remote guard still applies.
- Seeding creates ten synthetic profiles: the eight-profile Org A chain, `DEV-ADMIN`, and `DEV-ORGB-MR` in `Dev Org B`. Random passwords are written only to ignored `dev-users.local`; the seed lists codes, roles and parents but never passwords or user IDs. `--reset-passwords` rotates those credentials. The SQL runner prepares rollback-only local fixtures; `npm run test:db` runs the real PostgREST hierarchy test after a local-only target guard.
- AI overrides are optional: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_REASONING`. The Lovable gateway remains unchanged by default. OpenAI uses Responses API; Gemini/OpenAI-compatible chat endpoints use Chat Completions and Gemini-specific request normalization. Extraction quality depends on the selected model; prompts, output schema and validation remain in the server helper.
- Migration `0012` is additive; never edit migrations `0000`–`0011`. SQL integration tests run in transactions and roll back. Any explicit cleanup hard DELETE must set the transaction-local `app.allow_hard_delete` escape hatch first.
- Target safety checks run before database connections and reject the tracked Lovable backend/project ID. `.env.local` and `dev-users.local` match the existing `*.local` ignore rule. Never share either file or paste credentials into logs.

## Voice dictation (Part C)
- The new-report page offers optional `en-IN` browser speech recognition only when the standard or WebKit-prefixed Web Speech API is available. Only finalized transcript segments are appended to the editable original note; users review and manually submit it. Dictation must never auto-submit, make an extra AI call, or store audio in the app.
- Show the user that the browser vendor's speech service may receive audio. Microphone access requires HTTPS or localhost; a plain LAN URL such as `http://192.168.x.x` is not a secure context. Unsupported browsers hide the control.
