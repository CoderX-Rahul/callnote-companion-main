import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { assertRepositoryTarget, REPO_ROOT } from "./safety.mjs";

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
if (!databaseUrl || !supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the local database integration test.",
  );
  process.exit(1);
}

try {
  const databaseTarget = assertRepositoryTarget(databaseUrl);
  const apiTarget = assertRepositoryTarget(supabaseUrl);
  if (!databaseTarget.isLocal || !apiTarget.isLocal)
    throw new Error("The database integration test only runs against local Supabase.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database target safety check failed.");
  process.exit(1);
}

const vitest = resolve(REPO_ROOT, "node_modules/vitest/vitest.mjs");
const child = spawn(
  process.execPath,
  [
    vitest,
    "run",
    "src/test/hierarchy.integration.test.ts",
    "src/test/draft-idempotency.integration.test.ts",
    "src/test/pob.integration.test.ts",
  ],
  {
    cwd: REPO_ROOT,
    env: { ...process.env, RUN_DB_INTEGRATION: "1" },
    stdio: "inherit",
  },
);
child.on("error", () => {
  console.error("Could not start the database integration test.");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
