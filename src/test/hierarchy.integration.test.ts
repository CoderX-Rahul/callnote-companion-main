import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeSubtreeIds,
  profileReportScope,
  scoped,
  scopedOwn,
  type MrProfile,
  type ScopedMrProfile,
} from "@/lib/mr-auth";

const runDb = process.env["RUN_DB_INTEGRATION"] === "1";
const dbUrl = process.env["DATABASE_URL"];
const supabaseUrl = process.env["SUPABASE_URL"];
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const marker = `FIELDIQ-HIERARCHY-INTEGRATION-${randomUUID()}`;
const profileCodes = [
  "DEV-NSM",
  "DEV-ZSM",
  "DEV-RSM",
  "DEV-ASM-A",
  "DEV-ASM-B",
  "DEV-MR-A1",
  "DEV-MR-A2",
  "DEV-MR-B1",
  "DEV-ADMIN",
  "DEV-ORGB-MR",
];
const reportIds = new Map<string, string>();
const idByCode = new Map<string, string>();
const scopeByCode = new Map<string, ScopedMrProfile>();
let sql: ReturnType<typeof postgres> | undefined;
let supabase: ReturnType<typeof createClient> | undefined;

type ReportRow = {
  id: string;
  mr_profile_id: string;
  organization_id: string;
  original_note: string;
  deleted_at: string | null;
};
type ReportResult = { data: ReportRow[] | null; error: Error | null };
type SingleReportResult = { data: ReportRow | null; error: Error | null };
interface ReportQuery extends PromiseLike<ReportResult> {
  select(columns: string): ReportQuery;
  update(values: Record<string, unknown>): ReportQuery;
  eq(column: string, value: string): ReportQuery;
  in(column: string, values: string[]): ReportQuery;
  is(column: string, value: null): ReportQuery;
  like(column: string, pattern: string): ReportQuery;
  maybeSingle(): PromiseLike<SingleReportResult>;
}

// Keep the generated Supabase report-table type gap local to this integration helper.
function callReports(): ReportQuery {
  return supabase!.from("call_reports") as unknown as ReportQuery;
}

const roleCodes: Record<string, string[]> = {
  "DEV-MR-A1": ["DEV-MR-A1"],
  "DEV-MR-A2": ["DEV-MR-A2"],
  "DEV-MR-B1": ["DEV-MR-B1"],
  "DEV-ASM-A": ["DEV-ASM-A", "DEV-MR-A1", "DEV-MR-A2"],
  "DEV-ASM-B": ["DEV-ASM-B", "DEV-MR-B1"],
  "DEV-RSM": ["DEV-RSM", "DEV-ASM-A", "DEV-ASM-B", "DEV-MR-A1", "DEV-MR-A2", "DEV-MR-B1"],
  "DEV-ZSM": [
    "DEV-ZSM",
    "DEV-RSM",
    "DEV-ASM-A",
    "DEV-ASM-B",
    "DEV-MR-A1",
    "DEV-MR-A2",
    "DEV-MR-B1",
  ],
  "DEV-NSM": profileCodes.slice(0, 9),
  "DEV-ADMIN": profileCodes.slice(0, 9),
  "DEV-ORGB-MR": ["DEV-ORGB-MR"],
};

describe.skipIf(!runDb)("database-backed hierarchy isolation", () => {
  beforeAll(async () => {
    if (!dbUrl || !supabaseUrl || !serviceRoleKey)
      throw new Error("Local Supabase environment is incomplete.");
    sql = postgres(dbUrl, { max: 1, prepare: false });
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const profiles = (await sql`
      select id, user_id, organization_id, full_name, employee_code, division, territory, headquarters, role, reports_to, active
      from public.mr_profiles where employee_code in ${sql(profileCodes)}
    `) as MrProfile[];
    expect(profiles.map((profile) => profile.employee_code).sort()).toEqual(
      [...profileCodes].sort(),
    );
    const hierarchy = profiles.map(({ id, reports_to }) => ({ id, reports_to }));
    const profileByCode = new Map(profiles.map((profile) => [profile.employee_code, profile]));

    const expectedAsmA = ["DEV-ASM-A", "DEV-MR-A1", "DEV-MR-A2"].map(
      (code) => profileByCode.get(code)!.id,
    );
    expect(computeSubtreeIds(profileByCode.get("DEV-ASM-A")!.id, hierarchy).sort()).toEqual(
      expectedAsmA.sort(),
    );

    for (const profile of profiles) {
      idByCode.set(profile.employee_code!, profile.id);
      const reportScope = profileReportScope(profile, hierarchy);
      scopeByCode.set(profile.employee_code!, { ...profile, reportScope });
    }

    await sql.begin(async (tx) => {
      for (const profile of profiles) {
        const [report] = await tx`
          insert into public.call_reports (organization_id, mr_profile_id, updated_by, original_note, status)
          values (${profile.organization_id}, ${profile.id}, ${profile.user_id}, ${`${marker} ${profile.employee_code}`}, 'draft')
          returning id
        `;
        if (!report) throw new Error("Could not insert a hierarchy report fixture.");
        reportIds.set(profile.employee_code!, report["id"]);
      }
      const [doctor] =
        await tx`select id, name, specialty, clinic from public.doctors order by id limit 1`;
      const [product] = await tx`select id, name from public.products order by id limit 1`;
      if (!doctor || !product)
        throw new Error("Master-data fixtures are required for the follow-up test.");
      const owner = profileByCode.get("DEV-MR-A1")!;
      const [followUp] = await tx`
        insert into public.call_reports (
          organization_id, mr_profile_id, updated_by, original_note, status, call_datetime, call_date_only,
          doctor_id, doctor_name, specialty, clinic, product_ids, product_names, purpose, follow_up_action
        ) values (
          ${owner.organization_id}, ${owner.id}, ${owner.user_id}, ${`${marker} follow-up`}, 'approved', now(),
          (now() at time zone 'Asia/Kolkata')::date, ${doctor["id"]}, ${doctor["name"]}, ${doctor["specialty"]}, ${doctor["clinic"]},
          ${[product["id"]]}, ${[product["name"]]}, 'Integration test', 'Integration follow-up'
        ) returning id
      `;
      if (!followUp) throw new Error("Could not insert the follow-up fixture.");
      reportIds.set("DEV-MR-A1-FOLLOWUP", followUp["id"]);
    });
  }, 120_000);

  afterAll(async () => {
    if (sql) {
      await sql.begin(async (tx) => {
        await tx`select set_config('app.allow_hard_delete', 'on', true)`;
        await tx`delete from public.call_reports where original_note like ${`${marker}%`}`;
      });
      await sql.end({ timeout: 5 });
    }
  });

  async function visibleReports(code: string) {
    const profile = scopeByCode.get(code)!;
    const result = await scoped(
      callReports()
        .select("id,mr_profile_id,organization_id,original_note,deleted_at")
        .like("original_note", `${marker}%`),
      profile,
    );
    if (result.error) throw result.error;
    return result.data ?? [];
  }

  it("enforces read visibility, cross-organization isolation, and direct-lookup isolation", async () => {
    const orgAReportIds = profileCodes.slice(0, 9).map((code) => reportIds.get(code)!);
    for (const [code, visibleCodes] of Object.entries(roleCodes)) {
      const expected = visibleCodes.map((visibleCode) => reportIds.get(visibleCode)!);
      if (visibleCodes.includes("DEV-MR-A1")) expected.push(reportIds.get("DEV-MR-A1-FOLLOWUP")!);
      const actual = (await visibleReports(code)).map((row) => row.id).sort();
      expect(actual, code).toEqual(expected.sort());
    }
    expect((await visibleReports("DEV-NSM")).map((row) => row.id)).toEqual(
      expect.arrayContaining(orgAReportIds),
    );

    const outOfScope = await scoped(
      callReports().select("id").eq("id", reportIds.get("DEV-MR-A1")!),
      scopeByCode.get("DEV-MR-B1")!,
    ).maybeSingle();
    expect(outOfScope.error).toBeNull();
    expect(outOfScope.data).toBeNull();
  });

  it("enforces owner-only save, soft delete, and follow-up writes, then hides the deleted draft", async () => {
    const draftId = reportIds.get("DEV-MR-A1")!;
    const mrA1 = scopeByCode.get("DEV-MR-A1")!;
    const asmA = scopeByCode.get("DEV-ASM-A")!;
    const userA1 = mrA1.user_id;

    const managerSave = await scopedOwn(
      callReports().update({ purpose: "Manager must not edit" }).eq("id", draftId),
      asmA,
    )
      .select("id")
      .maybeSingle();
    expect(managerSave.error).toBeNull();
    expect(managerSave.data).toBeNull();
    const ownerSave = await scopedOwn(
      callReports()
        .update({ purpose: "Owner edit verified", updated_by: userA1 })
        .eq("id", draftId),
      mrA1,
    )
      .select("id")
      .maybeSingle();
    expect(ownerSave.error).toBeNull();
    expect(ownerSave.data?.id).toBe(draftId);

    const deletion = {
      deleted_at: new Date().toISOString(),
      deleted_by: userA1,
      updated_by: userA1,
    };
    const managerDelete = await scopedOwn(
      callReports().update(deletion).eq("id", draftId).eq("status", "draft"),
      asmA,
    )
      .select("id")
      .maybeSingle();
    expect(managerDelete.error).toBeNull();
    expect(managerDelete.data).toBeNull();
    const ownerDelete = await scopedOwn(
      callReports().update(deletion).eq("id", draftId).eq("status", "draft"),
      mrA1,
    )
      .select("id")
      .maybeSingle();
    expect(ownerDelete.error).toBeNull();
    expect(ownerDelete.data?.id).toBe(draftId);

    const followUpId = reportIds.get("DEV-MR-A1-FOLLOWUP")!;
    const managerFollowUp = await scopedOwn(
      callReports().update({ follow_up_done: true, updated_by: asmA.user_id }).eq("id", followUpId),
      asmA,
    )
      .select("id")
      .maybeSingle();
    expect(managerFollowUp.error).toBeNull();
    expect(managerFollowUp.data).toBeNull();
    const ownerFollowUp = await scopedOwn(
      callReports().update({ follow_up_done: true, updated_by: userA1 }).eq("id", followUpId),
      mrA1,
    )
      .select("id")
      .maybeSingle();
    expect(ownerFollowUp.error).toBeNull();
    expect(ownerFollowUp.data?.id).toBe(followUpId);

    for (const code of profileCodes) {
      expect(
        (await visibleReports(code)).map((row) => row.id),
        code,
      ).not.toContain(draftId);
    }
  }, 120_000);
});
