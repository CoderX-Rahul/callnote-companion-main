export const DEV_PROFILE_DEFINITIONS = Object.freeze([
  { email: "nsm.test@example.com", role: "nsm", employee_code: "DEV-NSM", full_name: "Dev National Sales Manager", parent_employee_code: null },
  { email: "zsm.test@example.com", role: "zsm", employee_code: "DEV-ZSM", full_name: "Dev Zonal Sales Manager", parent_employee_code: "DEV-NSM" },
  { email: "rsm.test@example.com", role: "rsm", employee_code: "DEV-RSM", full_name: "Dev Regional Sales Manager", parent_employee_code: "DEV-ZSM" },
  { email: "asm.a.test@example.com", role: "asm", employee_code: "DEV-ASM-A", full_name: "Dev Area Sales Manager A", parent_employee_code: "DEV-RSM" },
  { email: "asm.b.test@example.com", role: "asm", employee_code: "DEV-ASM-B", full_name: "Dev Area Sales Manager B", parent_employee_code: "DEV-RSM" },
  { email: "mr.a1.test@example.com", role: "mr", employee_code: "DEV-MR-A1", full_name: "Dev MR A1", parent_employee_code: "DEV-ASM-A" },
  { email: "mr.a2.test@example.com", role: "mr", employee_code: "DEV-MR-A2", full_name: "Dev MR A2", parent_employee_code: "DEV-ASM-A" },
  { email: "mr.b1.test@example.com", role: "mr", employee_code: "DEV-MR-B1", full_name: "Dev MR B1", parent_employee_code: "DEV-ASM-B" },
]);

export const DEV_EXTRA_PROFILE_DEFINITIONS = Object.freeze([
  { email: "admin.test@example.com", role: "admin", employee_code: "DEV-ADMIN", full_name: "Dev Organization Admin", parent_employee_code: null, organization: "demo", ensure_password: true },
  { email: "orgb.mr.test@example.com", role: "mr", employee_code: "DEV-ORGB-MR", full_name: "Dev MR Org B", parent_employee_code: null, organization: "org-b", ensure_password: true, rebind_orphan_user: true },
]);

export function migrationOrder(journal) {
  if (!journal || !Array.isArray(journal.entries)) throw new Error("Migration journal has no entries array.");
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const seen = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.idx !== index || typeof entry.tag !== "string" || !/^\d{4}_[A-Za-z0-9_]+$/.test(entry.tag) || seen.has(entry.tag)) {
      throw new Error("Migration journal order or tag is invalid.");
    }
    seen.add(entry.tag);
  }
  return entries.map((entry) => entry.tag);
}

function normalizedUrl(value) {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

/** Reject the tracked Lovable backend and require an explicit flag for every remote target. */
export function assertSafeTarget(target, { trackedSupabaseUrl, protectedProjectId, allowRemote = false } = {}) {
  if (typeof target !== "string" || target.length === 0) throw new Error("Target URL is missing.");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("Target URL is invalid.");
  }
  if (trackedSupabaseUrl) {
    try {
      if (normalizedUrl(target) === normalizedUrl(trackedSupabaseUrl)) {
        throw new Error("Refusing to use the backend configured in the tracked .env file.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
      // The protected value may be absent or not parseable; the project-id guard still applies.
    }
  }
  if (protectedProjectId && target.toLowerCase().includes(protectedProjectId.toLowerCase())) {
    throw new Error("Refusing to use a target containing the project_id from root supabase/config.toml.");
  }
  if (!(["postgres:", "postgresql:", "http:", "https:"].includes(parsed.protocol))) {
    throw new Error("Target URL must use PostgreSQL or HTTP(S).");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (!isLocal && !allowRemote) throw new Error("Remote targets require the explicit --allow-remote flag.");
  return { isLocal, hostname: parsed.hostname };
}

export function buildHierarchySeed() {
  return DEV_PROFILE_DEFINITIONS.map((profile) => ({ ...profile }));
}

export function isNonTransactionalMigration(source) {
  const sql = source.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\b(?:CREATE|DROP)\s+INDEX\s+CONCURRENTLY\b|\bVACUUM\b|\bCREATE\s+DATABASE\b|\bALTER\s+SYSTEM\b|\bREINDEX\s+CONCURRENTLY\b|\bREFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\b/i.test(sql);
}

export function sanitizeDatabaseMessage(message) {
  return String(message)
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/gi, "[database URL redacted]")
    .replace(/\b[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}\b/g, "[id redacted]")
    .replace(/\b(?:sb_secret|sb_publishable|eyJ)[A-Za-z0-9._-]+/g, "[key redacted]");
}
