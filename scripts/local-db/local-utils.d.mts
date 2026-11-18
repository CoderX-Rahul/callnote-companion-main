export interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

export interface SafeTargetOptions {
  trackedSupabaseUrl?: string;
  protectedProjectId?: string;
  allowRemote?: boolean;
}

export interface DevProfileDefinition {
  email: string;
  role: "mr" | "asm" | "rsm" | "zsm" | "nsm";
  employee_code: string;
  full_name: string;
  parent_employee_code: string | null;
}

export const DEV_PROFILE_DEFINITIONS: readonly DevProfileDefinition[];
export function migrationOrder(journal: MigrationJournal): string[];
export function assertSafeTarget(target: string, options?: SafeTargetOptions): { isLocal: boolean; hostname: string };
export function buildHierarchySeed(): DevProfileDefinition[];
export function isNonTransactionalMigration(source: string): boolean;
export function sanitizeDatabaseMessage(message: unknown): string;
