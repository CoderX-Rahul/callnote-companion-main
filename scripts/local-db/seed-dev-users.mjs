import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildHierarchySeed, DEV_EXTRA_PROFILE_DEFINITIONS, sanitizeDatabaseMessage } from "./local-utils.mjs";
import { assertRepositoryTarget, parseArgs, REPO_ROOT } from "./safety.mjs";

const { allowRemote, resetPasswords } = parseArgs(process.argv.slice(2));
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.");
  process.exit(1);
}
try {
  assertRepositoryTarget(supabaseUrl, allowRemote);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backend safety check failed.");
  process.exit(1);
}

const migrationPath = resolve(REPO_ROOT, "drizzle/migrations/0009_phase4a_mr_profiles_ownership.sql");
const migration0009 = readFileSync(migrationPath, "utf8");
const organizationMatch = migration0009.match(/INSERT\s+INTO\s+public\.organizations\s*\(\s*id\s*,\s*name\s*\)\s*VALUES\s*\(\s*'([^']+)'/i);
const demoOrganizationId = organizationMatch?.[1];
if (!demoOrganizationId) {
  console.error("Could not read the demo organization id from migration 0009.");
  process.exit(1);
}

const credentialsPath = resolve(REPO_ROOT, "dev-users.local");
let credentials = { users: [] };
if (existsSync(credentialsPath)) {
  try {
    credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
    if (!credentials || !Array.isArray(credentials.users)) throw new Error("invalid");
  } catch {
    console.error("dev-users.local is not valid JSON; move it aside or repair it before seeding.");
    process.exit(1);
  }
}

function writeCredentials() {
  const body = JSON.stringify(credentials, null, 2) + "\n";
  const tempPath = `${credentialsPath}.${process.pid}.tmp.local`;
  writeFileSync(tempPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    renameSync(tempPath, credentialsPath);
  } catch {
    writeFileSync(credentialsPath, body, { encoding: "utf8", mode: 0o600 });
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function newPassword() {
  return randomBytes(32).toString("base64url");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const hierarchyCheck = await supabase.from("mr_profiles").select("id,reports_to").limit(1);
  if (hierarchyCheck.error) {
    throw new Error("Migration 0011 (reports_to hierarchy) is not available. Apply it before seeding users.");
  }
  const organization = await supabase.from("organizations").select("id").eq("id", demoOrganizationId).maybeSingle();
  if (organization.error || !organization.data) throw new Error("The 0009 demo organization is not present. Apply migrations before seeding users.");

  const existingUsers = new Map();
  const managedAuthUserIds = new Set();
  for (let page = 1; ; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Could not list users through the Supabase admin API.");
    for (const user of result.data.users) {
      managedAuthUserIds.add(user.id);
      if (user.email) existingUsers.set(user.email.toLowerCase(), user);
    }
    if (result.data.users.length < 1000) break;
  }

  const authUserIds = new Map();
  const definitions = [...buildHierarchySeed(), ...DEV_EXTRA_PROFILE_DEFINITIONS];
  let orgB = null;
  if (DEV_EXTRA_PROFILE_DEFINITIONS.some((definition) => definition.organization === "org-b")) {
    const foundOrgB = await supabase.from("organizations").select("id").eq("name", "Dev Org B").maybeSingle();
    if (foundOrgB.error) throw new Error("Could not read Dev Org B.");
    if (foundOrgB.data) orgB = foundOrgB.data;
    else {
      const insertedOrgB = await supabase.from("organizations").insert({ name: "Dev Org B" }).select("id").single();
      if (insertedOrgB.error || !insertedOrgB.data) throw new Error("Could not create Dev Org B.");
      orgB = insertedOrgB.data;
    }
  }

  for (const definition of definitions) {
    const existing = existingUsers.get(definition.email.toLowerCase());
    let authUser = existing;
    const saved = credentials.users.find((entry) => entry.email.toLowerCase() === definition.email.toLowerCase());
    if (existing && !resetPasswords && (saved || !definition.ensure_password)) {
      if (!saved) console.log(`Skipped existing user ${definition.email}; use --reset-passwords to create a locally stored password.`);
      else console.log(`Skipped existing user ${definition.email}.`);
    } else {
      const password = newPassword();
      const result = existing
        ? await supabase.auth.admin.updateUserById(existing.id, { password })
        : await supabase.auth.admin.createUser({ email: definition.email, password, email_confirm: true });
      if (result.error || !result.data.user) {
        throw new Error(`Could not ${existing ? "reset" : "create"} ${definition.email} through the Supabase admin API.`);
      }
      authUser = result.data.user;
      credentials.users = credentials.users.filter((entry) => entry.email.toLowerCase() !== definition.email.toLowerCase());
      credentials.users.push({ email: definition.email, role: definition.role, password });
      writeCredentials();
      console.log(`${existing ? "Reset" : "Created"} user ${definition.email}.`);
    }
    if (!authUser?.id) throw new Error(`Could not resolve the account for ${definition.email}.`);
    authUserIds.set(definition.email.toLowerCase(), authUser.id);
  }

  const profileIds = new Map();
  for (const definition of definitions) {
    const userId = authUserIds.get(definition.email.toLowerCase());
    const reportsTo = definition.parent_employee_code ? profileIds.get(definition.parent_employee_code) : null;
    if (!userId || (definition.parent_employee_code && !reportsTo)) {
      throw new Error(`Could not construct the hierarchy before ${definition.employee_code}.`);
    }

    const organizationId = definition.organization === "org-b" ? orgB?.id : organization.data.id;
    if (!organizationId) throw new Error(`Could not resolve organization for ${definition.employee_code}.`);
    const found = await supabase.from("mr_profiles")
      .select("id,user_id,role,reports_to")
      .eq("employee_code", definition.employee_code)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (found.error) throw new Error(`Could not read profile ${definition.employee_code}.`);

    let profileId;
    if (found.data) {
      if (found.data.role !== definition.role || found.data.reports_to !== reportsTo) {
        throw new Error(`Existing profile ${definition.employee_code} does not match this local seed; no profile was changed.`);
      }
      if (found.data.user_id !== userId && definition.rebind_orphan_user && !managedAuthUserIds.has(found.data.user_id)) {
        const rebound = await supabase.from("mr_profiles").update({ user_id: userId })
          .eq("id", found.data.id).eq("user_id", found.data.user_id).select("id").single();
        if (rebound.error || !rebound.data) throw new Error("Could not repair the orphaned local Org B seed profile.");
      } else if (found.data.user_id !== userId) {
        throw new Error(`Existing profile ${definition.employee_code} does not match this local seed; no profile was changed.`);
      }
      profileId = found.data.id;
    } else {
      const inserted = await supabase.from("mr_profiles").insert({
        user_id: userId,
        organization_id: organizationId,
        full_name: definition.full_name,
        employee_code: definition.employee_code,
        role: definition.role,
        reports_to: reportsTo,
        active: true,
      }).select("id").single();
      if (inserted.error || !inserted.data) {
        throw new Error(`Could not insert profile ${definition.employee_code}: ${sanitizeDatabaseMessage(inserted.error?.message ?? "database error")}`);
      }
      profileId = inserted.data.id;
    }
    profileIds.set(definition.employee_code, profileId);
  }

  const verification = await supabase.from("mr_profiles")
    .select("id,organization_id,employee_code,role,reports_to")
    .in("organization_id", [organization.data.id, ...(orgB?.id ? [orgB.id] : [])])
    .in("employee_code", definitions.map((definition) => definition.employee_code))
    .order("employee_code");
  if (verification.error) throw new Error("Could not verify the seeded hierarchy.");
  const codeById = new Map(verification.data.map((row) => [row.id, row.employee_code]));
  console.log("\nEmployee code | Role | Reports to");
  for (const row of verification.data) {
    console.log(`${row.employee_code} | ${row.role} | ${row.reports_to ? codeById.get(row.reports_to) ?? "unknown" : "—"}`);
  }
  console.log(`Passwords are stored only in ${credentialsPath}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? sanitizeDatabaseMessage(error.message) : "Dev-user seeding failed.");
  process.exitCode = 1;
});
