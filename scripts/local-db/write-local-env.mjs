import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertRepositoryTarget, parseArgs, parseEnv, readProtectedBackend, REPO_ROOT } from "./safety.mjs";

const args = process.argv.slice(2);
const { allowRemote, force } = parseArgs(args);
const localPath = resolve(REPO_ROOT, ".env.local");
if (existsSync(localPath) && !force) {
  console.error(".env.local already exists. Use --force to replace its Supabase values.");
  process.exit(1);
}
const previous = existsSync(localPath) ? parseEnv(readFileSync(localPath, "utf8")) : {};
const projectConfig = readFileSync(resolve(REPO_ROOT, "scripts/local-db/supabase/config.toml"), "utf8");
const localProjectId = projectConfig.match(/^\s*project_id\s*=\s*"([^"]+)"\s*$/m)?.[1];
if (localProjectId !== "fieldiq-local" || localProjectId === readProtectedBackend().protectedProjectId) {
  console.error("Local Supabase config must use the isolated fieldiq-local project_id.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["supabase", "status", "-o", "env", "--workdir", "scripts/local-db"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 10 * 1024 * 1024,
});
if (result.status !== 0 || !result.stdout) {
  console.error("Could not read local Supabase status. Start the local stack and verify the Supabase CLI is available.");
  process.exit(result.status ?? 1);
}

try {
  const status = parseEnv(result.stdout);
  const apiUrl = status.API_URL;
  const dbUrl = status.DB_URL;
  const anonKey = status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !dbUrl || !anonKey || !serviceKey) throw new Error("Local Supabase status omitted required values.");
  assertRepositoryTarget(apiUrl, allowRemote);
  assertRepositoryTarget(dbUrl, allowRemote);

  const output = {
    VITE_SUPABASE_URL: apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
    VITE_SUPABASE_PROJECT_ID: "fieldiq-local",
    SUPABASE_PROJECT_ID: "fieldiq-local",
    SUPABASE_URL: apiUrl,
    SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    DATABASE_URL: dbUrl,
    LOVABLE_API_KEY: previous.LOVABLE_API_KEY ?? "",
    AI_BASE_URL: previous.AI_BASE_URL ?? "",
    AI_API_KEY: previous.AI_API_KEY ?? "",
    AI_MODEL: previous.AI_MODEL ?? "",
    AI_REASONING: previous.AI_REASONING ?? "false",
  };
  const body = Object.entries(output).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
  const tempPath = `${localPath}.${process.pid}.tmp.local`;
  writeFileSync(tempPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    renameSync(tempPath, localPath);
  } catch (error) {
    // On Windows, replacing an existing file can fail; --force explicitly authorizes this fallback.
    if (!force) throw error;
    writeFileSync(localPath, body, { encoding: "utf8", mode: 0o600 });
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
  console.log("Wrote .env.local for the isolated local Supabase backend. Keys were not printed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not write local environment file.");
  process.exit(1);
}
