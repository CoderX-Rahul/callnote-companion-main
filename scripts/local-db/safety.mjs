import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeTarget } from "./local-utils.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function parseEnv(source) {
  const values = {};
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function readProtectedBackend(root = REPO_ROOT) {
  const envText = readFileSync(resolve(root, ".env"), "utf8");
  const configText = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  const project = configText.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m);
  if (!project) throw new Error("Could not read project_id from root supabase/config.toml.");
  return { trackedSupabaseUrl: parseEnv(envText).VITE_SUPABASE_URL, protectedProjectId: project[1] };
}

export function assertRepositoryTarget(target, allowRemote = false, root = REPO_ROOT) {
  return assertSafeTarget(target, { ...readProtectedBackend(root), allowRemote });
}

export function assertNoViteServerSecrets(env) {
  const forbidden = Object.keys(env).filter((key) => key.startsWith("VITE_") && /SERVICE|DATABASE|SECRET|PASSWORD|PRIVATE|ADMIN/i.test(key));
  if (forbidden.length) {
    throw new Error(`Server-only variables must not use the VITE_ prefix: ${forbidden.join(", ")}`);
  }
}

export function parseArgs(argv) {
  return { allowRemote: argv.includes("--allow-remote"), force: argv.includes("--force"), dryRun: argv.includes("--dry-run"), resetPasswords: argv.includes("--reset-passwords") };
}
