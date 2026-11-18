import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readProtectedBackend, REPO_ROOT } from "./safety.mjs";

const action = process.argv[2];
const extraArgs = process.argv.slice(3);
if (action !== "start" && action !== "stop") {
  console.error("Usage: node scripts/local-db/supabase-control.mjs <start|stop>");
  process.exit(2);
}
if (extraArgs.some((arg) => arg !== "--no-backup") || (extraArgs.length && action !== "stop")) {
  console.error("Only `stop --no-backup` is supported as an extra local Supabase option.");
  process.exit(2);
}

try {
  const config = readFileSync(resolve(REPO_ROOT, "scripts/local-db/supabase/config.toml"), "utf8");
  const project = config.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m)?.[1];
  const protectedProjectId = readProtectedBackend().protectedProjectId;
  if (project !== "fieldiq-local" || project === protectedProjectId) {
    throw new Error("Local Supabase config must use the isolated fieldiq-local project_id.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local Supabase safety check failed.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["supabase", action, "--workdir", "scripts/local-db", ...extraArgs], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 10 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error(`Supabase ${action} did not complete (exit ${result.status ?? "unknown"}); command output was suppressed to protect generated credentials.`);
  process.exit(result.status ?? 1);
}
console.log(action === "start" ? "Local Supabase started; generated keys were suppressed." : "Local Supabase stopped.");
