import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { assertNoViteServerSecrets, assertRepositoryTarget, parseArgs, parseEnv, REPO_ROOT } from "./safety.mjs";

const args = process.argv.slice(2);
const { allowRemote } = parseArgs(args);
const envPath = resolve(REPO_ROOT, ".env.local");
let localEnv;
try {
  localEnv = parseEnv(readFileSync(envPath, "utf8"));
} catch {
  console.error("Missing .env.local. Start Supabase and run npm run db:local:env first.");
  process.exit(1);
}

try {
  assertNoViteServerSecrets(localEnv);
  const serverUrl = localEnv.SUPABASE_URL;
  const clientUrl = localEnv.VITE_SUPABASE_URL;
  if (!serverUrl || !clientUrl) throw new Error("Set both SUPABASE_URL and VITE_SUPABASE_URL in .env.local.");
  if (serverUrl.replace(/\/+$/, "") !== clientUrl.replace(/\/+$/, "")) {
    throw new Error("SUPABASE_URL and VITE_SUPABASE_URL must target the same backend.");
  }
  assertRepositoryTarget(serverUrl, allowRemote);
  assertRepositoryTarget(clientUrl, allowRemote);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local backend safety check failed.");
  process.exit(1);
}

const viteEntry = resolve(REPO_ROOT, "node_modules/vite/bin/vite.js");
const viteArgs = args.filter((arg) => arg !== "--allow-remote");
const child = spawn(process.execPath, ["--env-file=.env.local", viteEntry, "dev", ...viteArgs], {
  cwd: REPO_ROOT,
  env: { ...process.env, ...localEnv },
  stdio: "inherit",
});
child.on("error", () => {
  console.error("Could not start Vite.");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
