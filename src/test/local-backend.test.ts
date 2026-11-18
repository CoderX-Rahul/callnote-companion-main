import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertSafeTarget,
  buildHierarchySeed,
  migrationOrder,
} from "../../scripts/local-db/local-utils.mjs";

describe("local backend setup helpers", () => {
  it("uses the migration journal order through the latest migration", () => {
    const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
    const order = migrationOrder(journal);
    expect(order[0]).toBe("0000_migration");
    expect(order.at(-1)).toBe("0019_pob_unknown_free_quantity");
    expect(order).toHaveLength(journal.entries.length);
  });

  it("refuses the tracked Lovable URL and a target containing its project id", () => {
    const guard = {
      trackedSupabaseUrl: "https://tracked-project.example.invalid",
      protectedProjectId: "tracked-project",
    };
    expect(() => assertSafeTarget("https://tracked-project.example.invalid", guard)).toThrow(
      /tracked \.env/,
    );
    expect(() => assertSafeTarget("postgresql://localhost/tracked-project", guard)).toThrow(
      /project_id/,
    );
  });

  it("allows localhost and 127.0.0.1 targets by default", () => {
    expect(assertSafeTarget("http://localhost:54321", {})).toMatchObject({
      isLocal: true,
      hostname: "localhost",
    });
    expect(assertSafeTarget("postgresql://127.0.0.1:54322/postgres", {})).toMatchObject({
      isLocal: true,
      hostname: "127.0.0.1",
    });
  });

  it("requires --allow-remote semantics for any non-loopback target", () => {
    expect(() => assertSafeTarget("https://separate-project.example.invalid", {})).toThrow(
      /--allow-remote/,
    );
    expect(
      assertSafeTarget("https://separate-project.example.invalid", { allowRemote: true }),
    ).toMatchObject({ isLocal: false });
  });

  it("constructs the required top-down eight-profile hierarchy", () => {
    const hierarchy = buildHierarchySeed();
    expect(hierarchy.map((profile) => profile.employee_code)).toEqual([
      "DEV-NSM",
      "DEV-ZSM",
      "DEV-RSM",
      "DEV-ASM-A",
      "DEV-ASM-B",
      "DEV-MR-A1",
      "DEV-MR-A2",
      "DEV-MR-B1",
    ]);
    expect(hierarchy.map((profile) => profile.parent_employee_code)).toEqual([
      null,
      "DEV-NSM",
      "DEV-ZSM",
      "DEV-RSM",
      "DEV-RSM",
      "DEV-ASM-A",
      "DEV-ASM-A",
      "DEV-ASM-B",
    ]);
    expect(hierarchy.map((profile) => profile.role)).toEqual([
      "nsm",
      "zsm",
      "rsm",
      "asm",
      "asm",
      "mr",
      "mr",
      "mr",
    ]);
  });
});
