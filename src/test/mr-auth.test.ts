import { describe, expect, it } from "vitest";
import { profileRejection, profileReportScope, reportScope } from "@/lib/mr-auth";

const base = { id: "p1", organization_id: "org1" };

describe("report read scope by role", () => {
  it("scopes an MR to its own profile only", () => {
    expect(reportScope({ ...base, role: "mr" })).toEqual({ kind: "profiles", profileIds: ["p1"] });
  });
  it.each(["asm", "rsm", "zsm"] as const)("requires the middleware-computed subtree scope for %s", (role) => {
    expect(profileReportScope({ ...base, role }, [
      { id: "p1", reports_to: null }, { id: "child", reports_to: "p1" },
    ])).toEqual({ kind: "profiles", profileIds: ["p1", "child"] });
  });
  it.each(["nsm", "manager", "admin"] as const)("scopes %s to its organization", (role) => {
    expect(profileReportScope({ ...base, role })).toEqual({ kind: "organization", organizationId: "org1" });
  });
  it("fails closed for an unrecognised role", () => {
    expect(profileReportScope({ ...base, role: "superuser" as "mr" })).toEqual({ kind: "profiles", profileIds: ["p1"] });
  });
  it("uses only the verified profile id, never a client-supplied user id", () => {
    expect(reportScope({ ...base, role: "mr" })).toEqual({ kind: "profiles", profileIds: ["p1"] });
  });
});

describe("profile authorization gate", () => {
  it("rejects a missing profile (unapproved account)", () => {
    expect(profileRejection(null)).toMatch(/not provisioned/);
    expect(profileRejection(undefined)).toMatch(/not provisioned/);
  });
  it("rejects an inactive profile", () => {
    expect(profileRejection({ active: false })).toMatch(/inactive/);
  });
  it("allows an active provisioned profile", () => {
    expect(profileRejection({ active: true })).toBeNull();
  });
});
