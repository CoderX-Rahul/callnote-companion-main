import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeDatabaseMessage } from "./local-utils.mjs";
import { assertRepositoryTarget, parseArgs, REPO_ROOT } from "./safety.mjs";
import { buildHierarchySeed } from "./local-utils.mjs";

const { allowRemote } = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Run db:local:env first.");
  process.exit(1);
}
let targetInfo;
try {
  targetInfo = assertRepositoryTarget(databaseUrl, allowRemote);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database target safety check failed.");
  process.exit(1);
}

const requiredTests = [
  "src/test/phase4a-ownership.integration.sql",
  "src/test/phase4a-hardening.integration.sql",
  "src/test/phase4a-soft-delete.integration.sql",
  "src/test/phase4a-schema.integration.sql",
  "src/test/phase4a3-idempotent-drafts.integration.sql",
  "src/test/phase4b-pob.integration.sql",
];
const optionalHierarchyTest = "src/test/phase4a2-hierarchy.integration.sql";
const missing = requiredTests.filter((relativePath) => !existsSync(resolve(REPO_ROOT, relativePath)));
if (missing.length) {
  for (const path of missing) console.error(`FAIL ${path}: required SQL test file is missing.`);
  process.exit(1);
}
const tests = [...requiredTests, ...(existsSync(resolve(REPO_ROOT, optionalHierarchyTest)) ? [optionalHierarchyTest] : [])];
const { default: postgres } = await import("postgres");
const sql = postgres(databaseUrl, { max: 1, prepare: false });
let failed = false;

const ownershipAuthId = "86ea9840-0a34-4527-a4b7-5174a079dfcc";
const bootstrapAuthId = "1d528779-5df6-47e2-a12c-8799da249ff7";
const demoOrganizationId = "00000000-0000-4000-8000-000000000001";
const orgBId = "40000000-0000-4000-8000-000000000001";
const orgBProfileId = "40000000-0000-4000-8000-000000000002";

async function insertAuthFixture(tx, id, email) {
  const columns = await tx`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
  `;
  const available = new Set(columns.map((column) => column.column_name));
  const values = {
    id, aud: "authenticated", role: "authenticated", email,
    encrypted_password: "", email_confirmed_at: new Date(),
    raw_app_meta_data: { provider: "email", providers: ["email"] },
    raw_user_meta_data: { local_sql_fixture: true },
    created_at: new Date(), updated_at: new Date(),
  };
  const missingRequired = columns
    .filter((column) => column.is_nullable === "NO" && column.column_default == null && !Object.hasOwn(values, column.column_name))
    .map((column) => column.column_name);
  if (missingRequired.length) throw new Error("Local auth.users has unsupported required columns.");
  const names = Object.keys(values).filter((key) => available.has(key));
  const columnsSql = names.map((name) => `"${name}"`).join(", ");
  const params = names.map((_, index) => `$${index + 1}`).join(", ");
  await tx.unsafe(`insert into auth.users (${columnsSql}) values (${params}) on conflict (id) do nothing`, names.map((name) => values[name]));
}

async function ensureSqlFixtures() {
  const requiredAuthIds = [ownershipAuthId, bootstrapAuthId];
  const authRows = await sql`select id from auth.users where id in ${sql(requiredAuthIds)}`;
  const presentAuthIds = new Set(authRows.map((row) => row.id));
  const missingAuthIds = requiredAuthIds.filter((id) => !presentAuthIds.has(id));
  const hierarchy = await sql`
    select employee_code, id, user_id, organization_id, role from public.mr_profiles
    where employee_code in ${sql([...buildHierarchySeed().map((item) => item.employee_code), "DEV-ORGB-MR"])}
  `;
  const presentCodes = new Set(hierarchy.map((row) => row.employee_code));
  const missingCodes = [...buildHierarchySeed().map((item) => item.employee_code), "DEV-ORGB-MR"]
    .filter((code) => !presentCodes.has(code));
  if (targetInfo?.isLocal !== true && (missingAuthIds.length || missingCodes.length)) {
    throw new Error("Remote SQL test target is missing prerequisite fixtures; remote fixture creation is disabled.");
  }

  await sql.begin(async (tx) => {
    if (targetInfo?.isLocal) {
      if (!presentAuthIds.has(ownershipAuthId)) await insertAuthFixture(tx, ownershipAuthId, "ownership-fixture@local.invalid");
      if (!presentAuthIds.has(bootstrapAuthId)) await insertAuthFixture(tx, bootstrapAuthId, "bootstrap-fixture@local.invalid");
      await tx`insert into public.organizations (id, name) values (${orgBId}, 'Dev Org B') on conflict (id) do update set name = excluded.name`;

      for (const [index, definition] of buildHierarchySeed().entries()) {
        if (presentCodes.has(definition.employee_code)) continue;
        const userId = `41000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        await insertAuthFixture(tx, userId, `${definition.employee_code.toLowerCase()}@local.invalid`);
        const parent = definition.parent_employee_code
          ? await tx`select id from public.mr_profiles where employee_code = ${definition.parent_employee_code} limit 1`
          : [];
        if (definition.parent_employee_code && !parent[0]) throw new Error(`Missing parent fixture ${definition.parent_employee_code}.`);
        await tx`
          insert into public.mr_profiles (id, user_id, organization_id, full_name, employee_code, role, active, reports_to)
          values (${`42000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`}, ${userId}, ${demoOrganizationId}, ${definition.full_name}, ${definition.employee_code}, ${definition.role}, true, ${parent[0]?.id ?? null})
          on conflict (id) do nothing
        `;
      }

      if (!presentCodes.has("DEV-ORGB-MR")) {
        const userId = "41000000-0000-4000-8000-000000000009";
        await insertAuthFixture(tx, userId, "dev-orgb-mr@local.invalid");
        await tx`
          insert into public.mr_profiles (id, user_id, organization_id, full_name, employee_code, role, active)
          values (${orgBProfileId}, ${userId}, ${orgBId}, 'Dev MR Org B', 'DEV-ORGB-MR', 'mr', true)
          on conflict (id) do nothing
        `;
      }
    }
  });

  const demoProfile = await sql`select id from public.mr_profiles where id = '00000000-0000-4000-8000-000000000002' and user_id = ${bootstrapAuthId} and organization_id = ${demoOrganizationId}`;
  if (!demoProfile.length) throw new Error("The migration 0009 demo MR profile prerequisite is missing or mismatched.");
}

try {
  await ensureSqlFixtures();
  console.log("Prepared SQL integration fixtures.");
  for (const relativePath of tests) {
    const source = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
    try {
      if (relativePath === optionalHierarchyTest) {
        const requiredCodes = ["DEV-NSM", "DEV-ZSM", "DEV-RSM", "DEV-ASM-A", "DEV-ASM-B", "DEV-MR-A1", "DEV-MR-A2", "DEV-MR-B1", "DEV-ORGB-MR"];
        const fixtures = await sql`
          select employee_code, organization_id from public.mr_profiles
          where employee_code in ${sql(requiredCodes)}
        `;
        const fixtureCodes = new Set(fixtures.map((row) => row.employee_code));
        const missingCodes = requiredCodes.filter((code) => !fixtureCodes.has(code));
        const orgA = fixtures.find((row) => row.employee_code === "DEV-NSM")?.organization_id;
        const orgB = fixtures.find((row) => row.employee_code === "DEV-ORGB-MR")?.organization_id;
        if (missingCodes.length || !orgA || !orgB || orgA === orgB) {
          failed = true;
          const detail = missingCodes.length
            ? `missing profiles: ${missingCodes.join(", ")}`
            : "DEV-ORGB-MR must belong to an organization different from DEV-NSM";
          console.error(`FAIL ${relativePath}: ${detail}. Run npm run db:local:seed-users to provision the required local profiles.`);
          continue;
        }
      }
      await sql.unsafe(source);
      console.log(`PASS ${relativePath}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${relativePath}: ${sanitizeDatabaseMessage(error instanceof Error ? error.message : error)}`);
      await sql.unsafe("ROLLBACK").catch(() => {});
    }
  }
} finally {
  await sql.end({ timeout: 2 });
}

if (failed) process.exitCode = 1;
