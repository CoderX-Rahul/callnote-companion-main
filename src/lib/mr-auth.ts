import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MrRole = "mr" | "asm" | "rsm" | "zsm" | "nsm" | "manager" | "admin";

export interface MrProfile {
  id: string;
  user_id: string;
  organization_id: string;
  full_name: string;
  employee_code: string | null;
  division: string | null;
  territory: string | null;
  headquarters: string | null;
  role: MrRole;
  reports_to: string | null;
  active: boolean;
}

export type ReportScope =
  | { kind: "organization"; organizationId: string }
  | { kind: "profiles"; profileIds: string[] };

export type ScopedMrProfile = MrProfile & { reportScope: ReportScope };
export const MAX_SCOPED_PROFILE_IDS = 400;

type ReportingRow = { id: string; reports_to: string | null };

/** Returns root and all descendants; visited-set traversal also terminates on corrupt cycles. */
export function computeSubtreeIds(rootId: string, rows: ReportingRow[]): string[] {
  if (!rows.some((row) => row.id === rootId)) return [];
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (row.reports_to) children.set(row.reports_to, [...(children.get(row.reports_to) ?? []), row.id]);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    result.push(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  visit(rootId);
  return result;
}

/** Scope selection for verified, active profiles; unknown roles fail closed to self. */
export function profileReportScope(profile: Pick<MrProfile, "id" | "organization_id" | "role">, rows: ReportingRow[] = []): ReportScope {
  if (profile.role === "nsm" || profile.role === "admin" || profile.role === "manager") {
    return { kind: "organization", organizationId: profile.organization_id };
  }
  if (profile.role === "asm" || profile.role === "rsm" || profile.role === "zsm") {
    const profileIds = computeSubtreeIds(profile.id, rows);
    if (profileIds.length > MAX_SCOPED_PROFILE_IDS) {
      throw new Error(`Report scope includes more than ${MAX_SCOPED_PROFILE_IDS} profiles; refusing to truncate access scope.`);
    }
    return { kind: "profiles", profileIds };
  }
  return { kind: "profiles", profileIds: [profile.id] };
}

/** Returns a server-attached scope, with a fail-closed fallback for pure callers/tests. */
export function reportScope(
  profile: Pick<MrProfile, "id" | "organization_id" | "role"> & { reportScope?: ReportScope },
): ReportScope {
  return profile.reportScope ?? profileReportScope(profile);
}

/**
 * The generated Supabase types predate reports_to. Keep the single schema-compatibility cast
 * here until those generated types are refreshed.
 */
interface ExtendedProfilesQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): ExtendedProfilesQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
type ExtendedProfilesClient = {
  from(table: "mr_profiles"): { select(columns: string): ExtendedProfilesQuery };
};
function extendedMrProfiles(client: unknown) {
  return (client as ExtendedProfilesClient).from("mr_profiles");
}

async function loadOrgReportingRows(client: unknown, organizationId: string): Promise<ReportingRow[]> {
  const { data, error } = await extendedMrProfiles(client)
    .select("id,reports_to")
    .eq("organization_id", organizationId);
  if (error) throw error;
  if (data == null) return [];
  if (!Array.isArray(data)) throw new Error("Could not load reporting hierarchy.");
  return data.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || !("reports_to" in row)) {
      throw new Error("Could not load reporting hierarchy.");
    }
    const id = row.id;
    const reportsTo = row.reports_to;
    if (typeof id !== "string" || (reportsTo !== null && typeof reportsTo !== "string")) {
      throw new Error("Could not load reporting hierarchy.");
    }
    return { id, reports_to: reportsTo };
  });
}

/** Applies the authenticated caller's organization or profile-list read scope. */
export function scoped<T extends { eq: (c: string, v: string) => T; in: (c: string, v: string[]) => T; is: (c: string, v: null) => T }>(
  q: T,
  profile: Pick<ScopedMrProfile, "id" | "organization_id" | "role" | "reportScope">,
): T {
  const scope = reportScope(profile);
  if (scope.kind === "organization") return q.eq("organization_id", scope.organizationId).is("deleted_at", null);
  if (scope.profileIds.length > MAX_SCOPED_PROFILE_IDS) {
    throw new Error(`Report scope includes more than ${MAX_SCOPED_PROFILE_IDS} profiles; refusing to truncate access scope.`);
  }
  return q.in("mr_profile_id", scope.profileIds).is("deleted_at", null);
}

/** Writes are always limited to the report owner, even for team and organization readers. */
export function scopedOwn<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T, profile: Pick<MrProfile, "id">): T {
  return q.eq("mr_profile_id", profile.id).is("deleted_at", null);
}

type SoftDeleteValues = { deleted_at: string; deleted_by: string; updated_by: string };
interface SoftDeleteReportQuery {
  eq(column: string, value: string): SoftDeleteReportQuery;
  is(column: string, value: null): SoftDeleteReportQuery;
  select(columns: string): { single(): PromiseLike<{ data: unknown; error: unknown }> };
}

/** Isolates the generated Supabase type gap for migration 0012's additive soft-delete columns. */
export function softDeleteReportQuery(query: unknown, values: SoftDeleteValues): SoftDeleteReportQuery {
  return (query as { update(values: SoftDeleteValues): SoftDeleteReportQuery }).update(values);
}

/** Pure profile gate: missing or inactive profiles are rejected before any data access. */
export function profileRejection(profile: { active: boolean } | null | undefined): string | null {
  if (!profile) return "Your account is not provisioned. Contact your administrator.";
  if (!profile.active) return "Your account is inactive. Contact your administrator.";
  return null;
}

/** Loads the raw mr_profiles row for a verified Supabase Auth user id. */
export type ProfileLoader = (verifiedUserId: string) => PromiseLike<{ data: unknown; error: unknown }>;

/** Resolves an active profile from verified Auth identity; database errors propagate. */
export async function resolveMrProfile(verifiedUserId: string, load: ProfileLoader): Promise<MrProfile> {
  if (!verifiedUserId) throw new Error("Unauthorized: No user ID found in token");
  const { data, error } = await load(verifiedUserId);
  if (error) throw error;
  const profile = (data ?? null) as MrProfile | null;
  const rejection = profileRejection(profile);
  if (rejection) throw new Error(rejection);
  return profile as MrProfile;
}

/** Verifies the JWT, resolves its active profile, then attaches the server-computed read scope. */
export const requireMrProfile = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profile = await resolveMrProfile(context.userId, (userId) =>
      extendedMrProfiles(supabaseAdmin)
        .select("id,user_id,organization_id,full_name,employee_code,division,territory,headquarters,role,reports_to,active")
        .eq("user_id", userId)
        .maybeSingle(),
    );
    const rows = profile.role === "asm" || profile.role === "rsm" || profile.role === "zsm"
      ? await loadOrgReportingRows(supabaseAdmin, profile.organization_id)
      : [];
    const scopedProfile: ScopedMrProfile = { ...profile, reportScope: profileReportScope(profile, rows) };
    return next({ context: { profile: scopedProfile } });
  });
