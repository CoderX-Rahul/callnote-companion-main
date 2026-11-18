import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDb = process.env["RUN_DB_INTEGRATION"] === "1";
const databaseUrl = process.env["DATABASE_URL"];
const marker = `FIELDIQ-POB-INTEGRATION-${randomUUID()}`;
let sql: ReturnType<typeof postgres> | undefined;
let ownerId = "";
let organizationId = "";
let profileId = "";
const reportIds: string[] = [];

describe.skipIf(!runDb)("database-backed monthly POB totals", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Local database integration configuration is incomplete.");
    sql = postgres(databaseUrl, { max: 4, prepare: false });
    const [profile] =
      await sql`select id,user_id,organization_id from public.mr_profiles where employee_code='DEV-MR-A1'`;
    if (!profile)
      throw new Error("Local POB test profile is missing; run the local dev-user seed.");
    ownerId = String(profile["user_id"]);
    profileId = String(profile["id"]);
    organizationId = String(profile["organization_id"]);

    const booked = {
      lines: [
        {
          product_mention: "Cardiovex 10 mg",
          candidate_ids: ["PR-201"],
          product_id: "PR-201",
          quantity: 20,
          scheme_mention: "10+1",
          scheme_id: null,
          status: "Booked",
          free_quantity: 2,
          unit_mrp_snapshot: 125,
          discount_pct_snapshot: null,
          line_value: 2500,
          stated_unit_price: null,
          evidence: "Booked 20 Cardiovex",
          warnings: [],
        },
        {
          product_mention: "Glucorin XR",
          candidate_ids: ["PR-203"],
          product_id: "PR-203",
          quantity: 10,
          scheme_mention: null,
          scheme_id: null,
          status: "Booked",
          free_quantity: 0,
          unit_mrp_snapshot: 95,
          discount_pct_snapshot: null,
          line_value: 950,
          stated_unit_price: null,
          evidence: "10 Glucorin",
          warnings: [],
        },
      ],
    };
    const tentative = { ...booked, lines: [{ ...booked.lines[0]!, status: "Tentative" }] };
    const addReport = async (date: string, document: typeof booked, time = false) => {
      const original = `${marker} ${document.lines.map((line) => line.evidence).join(" ")}`;
      const [report] = await sql!`
        insert into public.call_reports(organization_id,mr_profile_id,updated_by,original_note,status,ai_pob)
        values (${organizationId},${profileId},${ownerId},${original},'draft',${sql!.json(document)}::jsonb)
        returning id
      `;
      const id = String(report!["id"]);
      reportIds.push(id);
      await sql!`
        update public.call_reports set doctor_id='DR-1001',
          call_date_only=${time ? null : date},
          call_datetime=${time ? `${date}T20:00:00Z` : null},
          product_ids=ARRAY['PR-201'],purpose='Monthly POB integration fixture',
          pob=${sql!.json(document)}::jsonb,status='approved',approved_at=now(),updated_by=${ownerId}
        where id=${id}
      `;
    };
    await addReport("2025-02-01", booked);
    await addReport("2025-01-31", tentative, true); // 20:00 UTC falls on Feb 1 in Asia/Kolkata.
  });

  afterAll(async () => {
    if (!sql) return;
    if (reportIds.length)
      await sql.begin(async (tx) => {
        await tx`select set_config('app.allow_hard_delete','on',true)`;
        await tx`delete from public.call_reports where id in ${tx(reportIds)}`;
      });
    await sql.end({ timeout: 2 });
  });

  it("counts approved reports and booked lines once, uses IST dates, and scopes to organization", async () => {
    if (!sql) throw new Error("Local database client was not initialized.");
    const [february] =
      await sql`select * from public.pob_monthly_totals(${organizationId}::uuid,ARRAY[${profileId}::uuid],'2025-02-01','2025-02-28')`;
    expect(february).toMatchObject({
      approved_calls: "2",
      booked_calls: "1",
      booked_lines: "2",
      booked_value: "3450.00",
    });
    const [january] =
      await sql`select * from public.pob_monthly_totals(${organizationId}::uuid,ARRAY[${profileId}::uuid],'2025-01-01','2025-01-31')`;
    expect(january).toMatchObject({
      approved_calls: "0",
      booked_calls: "0",
      booked_lines: "0",
      booked_value: "0",
    });
    const [wrongOrganization] =
      await sql`select * from public.pob_monthly_totals(${randomUUID()}::uuid,ARRAY[${profileId}::uuid],'2025-02-01','2025-02-28')`;
    expect(wrongOrganization).toMatchObject({ approved_calls: "0", booked_calls: "0" });
  });
});
