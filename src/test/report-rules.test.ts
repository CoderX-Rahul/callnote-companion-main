import { describe, expect, it } from "vitest";
import { combineDateTime, filterKnownIds, missingRequired, safeDate, toCsv } from "@/lib/report-rules";

describe("report rules", () => {
  it("blocks approval when doctor, date, products or purpose are missing", () => {
    expect(missingRequired({ doctor_id: null, call_datetime: null, product_ids: [], purpose: " " })).toEqual([
      "Doctor",
      "Call date",
      "Products discussed",
      "Purpose of visit",
    ]);
    expect(missingRequired({ doctor_id: "DR-1", call_datetime: "2026-10-28T11:15:00+05:30", product_ids: ["PR-1"], purpose: "Detailing" })).toEqual([]);
  });
  it("drops AI-suggested IDs not in master data", () => {
    expect(filterKnownIds(["DR-1001", "DR-9999"], new Set(["DR-1001"]))).toEqual(["DR-1001"]);
  });
  it("does not invent a time when only the date is known", () => {
    expect(combineDateTime("2026-10-28", null)).toBeNull();
    expect(combineDateTime("2026-10-28", "11:15")).toBe("2026-10-28T11:15:00+05:30");
  });
  it("rejects impossible dates", () => {
    expect(safeDate("2026-02-30")).toBeNull();
  });
  it("allows approval with a valid date and null exact time", () => {
    expect(missingRequired({ doctor_id: "DR-1001", call_date_only: "2026-10-31", call_datetime: null, product_ids: ["PR-201"], purpose: "Detailing" })).toEqual([]);
  });
  it("rejects impossible date-only approval", () => {
    expect(missingRequired({ doctor_id: "DR-1001", call_date_only: "2026-02-30", call_datetime: null, product_ids: ["PR-201"], purpose: "Detailing" })).toEqual(["Call date"]);
  });
  it.each(["24:00", "11:60", "99:99"])("rejects invalid time %s", (time) => {
    expect(combineDateTime("2026-10-31", time)).toBeNull();
  });
  it("escapes CSV cells", () => {
    expect(toCsv([{ id: "1", feedback: 'said "ok", fine' }]).split("\n")[1]).toContain('"said ""ok"", fine"');
  });
  it.each(["=1+1", "+SUM(1)", "-1+1", "@SUM(1)", "  =1+1", "\t=1+1", "\r=1+1", "\n=1+1", "\uFEFF=1+1"])("neutralizes spreadsheet formula %j", (formula) => {
    const row = toCsv([{ id: formula }]).slice(toCsv([]).length + 1);
    expect(row.startsWith("'" + formula) || row.startsWith('"\'' + formula)).toBe(true);
  });
  it("preserves ordinary CSV values", () => {
    expect(toCsv([{ id: "DR-1001" }]).split("\n")[1]?.split(",")[0]).toBe("DR-1001");
  });
});
