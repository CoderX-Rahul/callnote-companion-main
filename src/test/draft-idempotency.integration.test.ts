import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideDraftAction, type ExistingDraftRequest } from "@/lib/draft-idempotency";

const runDb = process.env["RUN_DB_INTEGRATION"] === "1";
const databaseUrl = process.env["DATABASE_URL"];
const ownerProfileId = "00000000-0000-4000-8000-000000000002";
const clientDraftId = randomUUID();
const noteSha = "d".repeat(64);
let sql: ReturnType<typeof postgres> | undefined;

describe.skipIf(!runDb)("database-backed idempotent draft claims", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Local database integration configuration is incomplete.");
    sql = postgres(databaseUrl, { max: 4, prepare: false });
    const owner = await sql`select id from public.mr_profiles where id = ${ownerProfileId}`;
    expect(owner).toHaveLength(1);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from public.ai_draft_requests where mr_profile_id = ${ownerProfileId} and client_draft_id = ${clientDraftId}`;
    await sql.end({ timeout: 2 });
  });

  it("returns exactly one claim winner and one in-progress result for concurrent requests", async () => {
    if (!sql) throw new Error("Local database client was not initialized.");
    const claim = async () => {
      const inserted = await sql!`
        insert into public.ai_draft_requests (mr_profile_id, client_draft_id, note_sha256, status)
        values (${ownerProfileId}, ${clientDraftId}, ${noteSha}, 'processing')
        on conflict (mr_profile_id, client_draft_id) do nothing
        returning client_draft_id
      `;
      if (inserted.length) return "winner";
      const [row] = await sql!`
        select note_sha256, status, report_id, updated_at
        from public.ai_draft_requests
        where mr_profile_id = ${ownerProfileId} and client_draft_id = ${clientDraftId}
      `;
      if (!row) throw new Error("Concurrent claim row was not visible.");
      const existing: ExistingDraftRequest = {
        note_sha256: String(row["note_sha256"]),
        status: String(row["status"]) as ExistingDraftRequest["status"],
        report_id: typeof row["report_id"] === "string" ? row["report_id"] : null,
        updated_at: new Date(String(row["updated_at"])).toISOString(),
      };
      return decideDraftAction(existing, noteSha, Date.now(), 120_000).action;
    };

    const results = await Promise.all([claim(), claim()]);
    expect(results.filter((result) => result === "winner")).toHaveLength(1);
    expect(results.filter((result) => result === "in_progress")).toHaveLength(1);
  }, 30_000);
});
