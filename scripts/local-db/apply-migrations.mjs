import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNonTransactionalMigration, migrationOrder, sanitizeDatabaseMessage } from "./local-utils.mjs";
import { assertRepositoryTarget, parseArgs, REPO_ROOT } from "./safety.mjs";

const { allowRemote, dryRun } = parseArgs(process.argv.slice(2));
const migrationDir = resolve(REPO_ROOT, "drizzle/migrations");
const journal = JSON.parse(readFileSync(resolve(migrationDir, "meta/_journal.json"), "utf8"));
const tags = migrationOrder(journal);
const databaseUrl = process.env.DATABASE_URL;
let targetInfo;

try {
  if (databaseUrl) targetInfo = assertRepositoryTarget(databaseUrl, allowRemote);
  else if (!dryRun) throw new Error("DATABASE_URL is missing. Run db:local:env first.");
  else if (allowRemote) throw new Error("--allow-remote requires a DATABASE_URL.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database target safety check failed.");
  process.exit(1);
}

for (const tag of tags) {
  const migrationPath = resolve(migrationDir, `${tag}.sql`);
  if (!existsSync(migrationPath)) {
    console.error(`Migration file is missing: ${tag}.sql`);
    process.exit(1);
  }
}

if (dryRun) {
  for (const tag of tags) console.log(tag);
  process.exit(0);
}

const { default: postgres } = await import("postgres");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

function bootstrapAuthUserId(source) {
  const insert = source.match(/INSERT\s+INTO\s+public\.mr_profiles\s*\(\s*id\s*,\s*user_id\s*,\s*organization_id\s*,[\s\S]*?\)\s*VALUES\s*\(\s*'[^']+'\s*,\s*'([^']+)'/i);
  const id = insert?.[1];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Could not safely read the bootstrap auth.users id from migration 0009.");
  return id;
}

async function ensureLocalBootstrapUser(tx, migrationSource) {
  const userId = bootstrapAuthUserId(migrationSource);
  const existing = await tx`select id from auth.users where id = ${userId} limit 1`;
  if (existing.length) return;
  if (!targetInfo.isLocal) {
    throw new Error("The 0009 bootstrap auth.users row is missing; its local-only bootstrap is disabled for remote targets.");
  }

  const columns = await tx`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
  `;
  const columnNames = new Set(columns.map((column) => column.column_name));
  if (!columnNames.has("id")) throw new Error("The local auth.users table is unavailable.");
  const values = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: null,
    encrypted_password: "",
    email_confirmed_at: null,
    raw_app_meta_data: { provider: "email", providers: ["email"] },
    raw_user_meta_data: {},
    created_at: new Date(),
    updated_at: new Date(),
  };
  const missingRequired = columns
    .filter((column) => column.is_nullable === "NO" && column.column_default == null && !Object.hasOwn(values, column.column_name))
    .map((column) => column.column_name);
  if (missingRequired.length) {
    throw new Error(`Local auth.users has unsupported required columns: ${missingRequired.join(", ")}.`);
  }
  const insertColumns = Object.keys(values).filter((column) => columnNames.has(column));
  const names = insertColumns.map((column) => `"${column}"`).join(", ");
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");
  const insertSql = `insert into auth.users (${names}) values (${placeholders}) on conflict (id) do nothing`;
  await tx.unsafe(insertSql, insertColumns.map((column) => values[column]));
}

try {
  await sql`create table if not exists public._local_migrations (
    tag text primary key,
    applied_at timestamptz not null default now()
  )`;

  for (const tag of tags) {
    const [recorded] = await sql`select tag from public._local_migrations where tag = ${tag}`;
    if (recorded) {
      console.log(`Skipped ${tag} (already recorded).`);
      continue;
    }
    const migrationPath = resolve(migrationDir, `${tag}.sql`);
    const source = readFileSync(migrationPath, "utf8");
    try {
      if (isNonTransactionalMigration(source)) {
        if (tag === "0009_phase4a_mr_profiles_ownership") await ensureLocalBootstrapUser(sql, source);
        await sql.unsafe(source);
        await sql`insert into public._local_migrations (tag) values (${tag})`;
      } else {
        await sql.begin(async (tx) => {
          if (tag === "0009_phase4a_mr_profiles_ownership") await ensureLocalBootstrapUser(tx, source);
          await tx.unsafe(source);
          await tx`insert into public._local_migrations (tag) values (${tag})`;
        });
      }
      console.log(`Applied ${tag}.`);
    } catch (error) {
      console.error(`Migration ${tag}.sql failed: ${sanitizeDatabaseMessage(error instanceof Error ? error.message : error)}`);
      process.exitCode = 1;
      break;
    }
  }
} catch (error) {
  console.error(`Migration runner failed: ${sanitizeDatabaseMessage(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
