import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  computeSubtreeIds,
  profileReportScope,
  resolveMrProfile,
  scoped,
  scopedOwn,
  type MrProfile,
  type MrRole,
  type ScopedMrProfile,
} from "@/lib/mr-auth";

type Row = { id: string; organization_id: string; mr_profile_id: string; deleted_at?: string | null };
type AppliedFilter = { method: "eq" | "in" | "is"; column: string; value: string | string[] | null };

class FakeQuery {
  constructor(readonly rows: Row[], readonly applied: AppliedFilter[] = []) {}
  eq(column: string, value: string): FakeQuery {
    return new FakeQuery(
      this.rows.filter((row) => (row as unknown as Record<string, string>)[column] === value),
      [...this.applied, { method: "eq", column, value }],
    );
  }
  in(column: string, values: string[]): FakeQuery {
    const allowed = new Set(values);
    return new FakeQuery(
      this.rows.filter((row) => {
        const candidate = (row as unknown as Record<string, string>)[column];
        return candidate !== undefined && allowed.has(candidate);
      }),
      [...this.applied, { method: "in", column, value: [...values] }],
    );
  }
  is(column: string, value: null): FakeQuery {
    return new FakeQuery(
      this.rows.filter((row) => {
        const candidate = (row as unknown as Record<string, string | null | undefined>)[column];
        return candidate === value || candidate === undefined;
      }),
      [...this.applied, { method: "is", column, value }],
    );
  }
  get ids() {
    return this.rows.map((row) => row.id).sort();
  }
}

const ORG_A = "org-a";
const ORG_B = "org-b";
const hierarchy = [
  { id: "nsm", reports_to: null },
  { id: "zsm", reports_to: "nsm" },
  { id: "rsm", reports_to: "zsm" },
  { id: "asm-a", reports_to: "rsm" },
  { id: "asm-b", reports_to: "rsm" },
  { id: "mr-a1", reports_to: "asm-a" },
  { id: "mr-a2", reports_to: "asm-a" },
  { id: "mr-b1", reports_to: "asm-b" },
  { id: "mr-org-b", reports_to: null },
];
const reportRows: Row[] = hierarchy.map((profile) => ({
  id: `report-${profile.id}`,
  organization_id: profile.id === "mr-org-b" ? ORG_B : ORG_A,
  mr_profile_id: profile.id,
}));
const table = () => new FakeQuery(reportRows);
const roles: Record<string, MrRole> = {
  nsm: "nsm", zsm: "zsm", rsm: "rsm", "asm-a": "asm", "asm-b": "asm",
  "mr-a1": "mr", "mr-a2": "mr", "mr-b1": "mr", "mr-org-b": "mr",
};
function profile(id: string, organization_id = ORG_A, role = roles[id] ?? "mr"): ScopedMrProfile {
  const row = hierarchy.find((item) => item.id === id);
  const base = { id, organization_id, role, reports_to: row?.reports_to ?? null };
  const scope = profileReportScope(base as Pick<MrProfile, "id" | "organization_id" | "role">, hierarchy);
  return { ...base, user_id: `user-${id}`, full_name: id, employee_code: id, division: null, territory: null, headquarters: null, active: true, reportScope: scope } as ScopedMrProfile;
}

describe("computeSubtreeIds", () => {
  it("returns a deep subtree across multiple branches", () => {
    expect(computeSubtreeIds("rsm", hierarchy)).toEqual(["rsm", "asm-a", "mr-a1", "mr-a2", "asm-b", "mr-b1"]);
  });
  it("does not attach orphaned profiles to an unrelated root", () => {
    expect(computeSubtreeIds("asm-a", [...hierarchy, { id: "orphan", reports_to: "missing" }])).toEqual([
      "asm-a", "mr-a1", "mr-a2",
    ]);
  });
  it("terminates safely when bad data contains a cycle", () => {
    expect(computeSubtreeIds("a", [
      { id: "a", reports_to: "b" }, { id: "b", reports_to: "a" }, { id: "c", reports_to: "b" },
    ])).toEqual(["a", "b", "c"]);
  });
  it("returns an empty list when the root is missing", () => {
    expect(computeSubtreeIds("absent", hierarchy)).toEqual([]);
  });
  it("rejects a subtree larger than the documented query limit", () => {
    const rows = [{ id: "root", reports_to: null }, ...Array.from({ length: 400 }, (_, i) => ({ id: `child-${i}`, reports_to: "root" }))];
    expect(() => profileReportScope({ id: "root", organization_id: ORG_A, role: "asm" }, rows)).toThrow(/more than 400/);
  });
});

describe("scoped(): five-role hierarchy visibility", () => {
  const cases: [string, ScopedMrProfile, string[]][] = [
    ["MR A1 sees only its own report", profile("mr-a1"), ["report-mr-a1"]],
    ["MR A2 sees only its own report", profile("mr-a2"), ["report-mr-a2"]],
    ["MR B1 sees only its own report", profile("mr-b1"), ["report-mr-b1"]],
    ["ASM A sees itself and both direct reports", profile("asm-a"), ["report-asm-a", "report-mr-a1", "report-mr-a2"]],
    ["ASM B sees itself and its direct report", profile("asm-b"), ["report-asm-b", "report-mr-b1"]],
    ["RSM sees both ASM branches and descendants", profile("rsm"), ["report-rsm", "report-asm-a", "report-asm-b", "report-mr-a1", "report-mr-a2", "report-mr-b1"]],
    ["ZSM sees its entire subtree", profile("zsm"), ["report-zsm", "report-rsm", "report-asm-a", "report-asm-b", "report-mr-a1", "report-mr-a2", "report-mr-b1"]],
    ["NSM sees the organization", profile("nsm"), reportRows.filter((row) => row.organization_id === ORG_A).map((row) => row.id)],
    ["admin sees the organization", { ...profile("nsm"), id: "admin", role: "admin", reportScope: { kind: "organization", organizationId: ORG_A } }, reportRows.filter((row) => row.organization_id === ORG_A).map((row) => row.id)],
    ["legacy manager sees the organization", { ...profile("nsm"), id: "manager", role: "manager", reportScope: { kind: "organization", organizationId: ORG_A } }, reportRows.filter((row) => row.organization_id === ORG_A).map((row) => row.id)],
    ["Org B MR sees only Org B data", profile("mr-org-b", ORG_B), ["report-mr-org-b"]],
    ["unknown role fails closed to its own reports", { ...profile("mr-a1"), role: "superuser" as MrRole, reportScope: { kind: "profiles", profileIds: ["mr-a1"] } }, ["report-mr-a1"]],
  ];
  it.each(cases)("%s", (_label, caller, expected) => {
    expect(scoped(table(), caller).ids).toEqual(expected.sort());
  });

  it("does not include siblings, parents, or another organization", () => {
    expect(scoped(table(), profile("asm-a")).ids).not.toContain("report-asm-b");
    expect(scoped(table(), profile("asm-a")).ids).not.toContain("report-rsm");
    expect(scoped(table(), profile("nsm")).ids).not.toContain("report-mr-org-b");
  });

  it("uses an explicit profile list for subtree roles and an organization filter for NSM", () => {
    expect(scoped(table(), profile("asm-a")).applied).toEqual([{
      method: "in", column: "mr_profile_id", value: ["asm-a", "mr-a1", "mr-a2"],
    }, { method: "is", column: "deleted_at", value: null }]);
    expect(scoped(table(), profile("nsm")).applied).toEqual([{
      method: "eq", column: "organization_id", value: ORG_A,
    }, { method: "is", column: "deleted_at", value: null }]);
  });

  it("blocks direct lookup of any report outside the caller's scope", () => {
    expect(scoped(table().eq("id", "report-mr-b1"), profile("asm-a")).ids).toEqual([]);
    expect(scoped(table().eq("id", "report-mr-a1"), profile("mr-b1")).ids).toEqual([]);
    expect(scoped(table().eq("id", "report-mr-org-b"), profile("nsm")).ids).toEqual([]);
  });

  it("filters soft-deleted reports from hierarchy and owner scopes", () => {
    const deleted = { ...reportRows.find((row) => row.id === "report-mr-a1")!, id: "deleted-report", deleted_at: "2026-11-16T10:00:00Z" };
    const query = () => new FakeQuery([...reportRows, deleted]);
    expect(scoped(query(), profile("nsm")).ids).not.toContain("deleted-report");
    expect(scopedOwn(query(), profile("mr-a1")).ids).not.toContain("deleted-report");
  });
});

describe("owner-only write scope", () => {
  it.each(["save", "delete", "mark done"])("prevents a team manager from using %s on a subordinate report", () => {
    expect(scopedOwn(table().eq("id", "report-mr-a1"), profile("asm-a")).ids).toEqual([]);
    expect(scopedOwn(table().eq("id", "report-mr-a1"), profile("mr-a1")).ids).toEqual(["report-mr-a1"]);
  });
});

const profileRow = (patch: Partial<MrProfile> = {}): MrProfile => ({
  id: "mr-a1", user_id: "user-1", organization_id: ORG_A, full_name: "Fixture MR", employee_code: null,
  division: null, territory: "T1", headquarters: null, role: "mr", reports_to: null, active: true, ...patch,
});

describe("resolveMrProfile (requireMrProfile)", () => {
  it("looks the profile up by the verified user id and returns the stored row", async () => {
    const load = vi.fn(async (id: string) => ({ data: profileRow({ user_id: id }), error: null }));
    const result = await resolveMrProfile("user-1", load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("user-1");
    expect(result).toMatchObject({ id: "mr-a1", organization_id: ORG_A, role: "mr" });
  });
  it("rejects an authenticated user with no profile", async () => {
    await expect(resolveMrProfile("user-2", async () => ({ data: null, error: null }))).rejects.toThrow(/not provisioned/);
  });
  it("rejects an inactive profile", async () => {
    await expect(resolveMrProfile("user-1", async () => ({ data: profileRow({ active: false }), error: null }))).rejects.toThrow(/inactive/);
  });
  it("propagates database errors", async () => {
    const dbError = new Error("connection reset");
    await expect(resolveMrProfile("user-1", async () => ({ data: null, error: dbError }))).rejects.toBe(dbError);
  });
  it("never queries without a verified user id", async () => {
    const load = vi.fn(async (id: string) => ({ data: profileRow({ user_id: id }), error: null }));
    await expect(resolveMrProfile("", load)).rejects.toThrow(/Unauthorized/);
    expect(load).not.toHaveBeenCalled();
  });
  it("takes the tenant from the stored row", async () => {
    const rows: Record<string, MrProfile> = {
      "user-a": profileRow({ id: "mr-a1", user_id: "user-a", organization_id: ORG_A }),
      "user-b": profileRow({ id: "mgr-b", user_id: "user-b", organization_id: ORG_B, role: "manager" }),
    };
    const load = async (id: string) => ({ data: rows[id] ?? null, error: null });
    expect((await resolveMrProfile("user-a", load)).organization_id).toBe(ORG_A);
    expect(profileReportScope(await resolveMrProfile("user-b", load))).toEqual({ kind: "organization", organizationId: ORG_B });
  });
});

describe("reports.functions.ts guard", () => {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(sourceDir, "../lib/reports.functions.ts"), "utf-8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const authSrc = readFileSync(resolve(sourceDir, "../lib/mr-auth.ts"), "utf-8");

  it("puts every server function behind requireMrProfile", () => {
    const fns = src.match(/createServerFn\(/g)?.length ?? 0;
    const guarded = src.match(/\.middleware\(\[requireMrProfile\]\)/g)?.length ?? 0;
    expect(fns).toBeGreaterThan(0);
    expect(guarded).toBe(fns);
  });

  it("scopes every non-insert call_reports query and keeps insert ownership server-derived", () => {
    const queries = src.match(/from\("call_reports"\)(?!\s*\.insert)/g)?.length ?? 0;
    const scopedCalls = src.match(/\bscoped(?:Own)?\(/g)?.length ?? 0;
    expect(queries).toBeGreaterThan(0);
    expect(scopedCalls).toBe(queries);
    expect(src).toContain("organization_id: context.profile.organization_id");
    expect(src).toContain("mr_profile_id: context.profile.id");
  });

  it("uses owner-only scope on every modifying endpoint query", () => {
    const body = (name: string) => src.split(`export const ${name} =`)[1]?.split("export const ")[0] ?? "";
    expect(body("saveReport").match(/\bscopedOwn\(/g)?.length).toBe(2);
    expect(body("deleteDraft")).toMatch(/scopedOwn\(/);
    expect(body("setFollowUpDone")).toMatch(/scopedOwn\(/);
  });

  it("applies the live-report filter centrally to both read and owner scopes", () => {
    expect(authSrc.match(/\.is\("deleted_at", null\)/g)).toHaveLength(3);
    expect(src).toContain("softDeleteReportQuery");
  });
});
