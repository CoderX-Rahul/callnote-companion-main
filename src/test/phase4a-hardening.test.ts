import { describe, expect, it } from "vitest";
import { normalizeEffectiveness } from "@/lib/report-effectiveness";
import { normalizeIntelligence, type Intelligence } from "@/lib/report-intelligence";
import { EXPORT_COLUMNS, toExportCsv } from "@/lib/report-export";
import { MIN_EVIDENCE_CHARS, addDays, effectiveCallDate, sortForExport, todayIST, toCsv, verbatimEvidence } from "@/lib/report-rules";

const known = new Set(["PR-201"]);
const NOTE = "Met Dr. Rao. Dropped 10 samples of Cardiovex. He committed to try Cardiovex on 5 patients by 15 Nov 2026.";

const sample = (patch: { quantity?: number | null; evidence?: string | null } = {}) => ({ product_mention: "Cardiovex", candidate_ids: ["PR-201"], quantity: 10, distribution_status: "Distributed" as const, evidence: "Dropped 10 samples of Cardiovex", ...patch });
const commitment = (patch: { commitment_date?: string | null; trial_patient_count?: number | null; evidence?: string | null } = {}) => ({ commitment_date: "2026-11-15", trial_patient_count: 5, status: "Doctor commitment" as const, follow_up_outcome: "Will report back", evidence: "committed to try Cardiovex on 5 patients by 15 Nov 2026", ...patch });
const eff = (samples: ReturnType<typeof sample>[], commitments: ReturnType<typeof commitment>[]) => ({ samples, collateral: [], commitments, hcp_tier: null, access_quality: "Unknown" });

describe("verbatimEvidence", () => {
  it("accepts a long-enough verbatim quote and trims it", () => {
    expect(verbatimEvidence("  Dropped 10 samples  ", NOTE)).toBe("Dropped 10 samples");
  });
  it.each(["", "a", "ok", "Met", "    "])("rejects too-short or empty evidence %j", (quote) => {
    expect(verbatimEvidence(quote, NOTE)).toBeNull();
  });
  it("rejects a quote that is not in the note, and null/undefined", () => {
    expect(verbatimEvidence("Dropped 99 samples", NOTE)).toBeNull();
    expect(verbatimEvidence(null, NOTE)).toBeNull();
    expect(verbatimEvidence(undefined, NOTE)).toBeNull();
  });
  it("enforces the minimum at its boundary", () => {
    const original = "xx abcde yy abcd";
    expect(MIN_EVIDENCE_CHARS).toBe(5);
    expect(verbatimEvidence("abcde", original)).toBe("abcde");
    expect(verbatimEvidence("abcd", original)).toBeNull();
  });
});

describe("effectiveness: unverified evidence resets dependent values", () => {
  it("keeps quantity, date and count when evidence is verified", () => {
    const e = normalizeEffectiveness(eff([sample()], [commitment()]), NOTE, known);
    expect(e.samples[0]).toMatchObject({ quantity: 10, distribution_status: "Distributed" });
    expect(e.commitments[0]).toMatchObject({ commitment_date: "2026-11-15", trial_patient_count: 5, status: "Doctor commitment" });
  });
  it("nulls the sample quantity (and status) when the quote is not in the note", () => {
    const e = normalizeEffectiveness(eff([sample({ evidence: "Dropped 500 samples of Cardiovex" })], []), NOTE, known);
    expect(e.samples[0]).toMatchObject({ quantity: null, distribution_status: "Unknown", evidence: null });
  });
  it("nulls the sample quantity when evidence is missing or a one-word string", () => {
    for (const evidence of [null, "ok", "10"]) {
      const e = normalizeEffectiveness(eff([sample({ evidence })], []), NOTE, known);
      expect(e.samples[0]).toMatchObject({ quantity: null, distribution_status: "Unknown", evidence: null });
    }
  });
  it("nulls commitment date and trial patient count, not just status and outcome, without verified evidence", () => {
    const e = normalizeEffectiveness(eff([], [commitment({ evidence: "not in the note" })]), NOTE, known);
    expect(e.commitments[0]).toMatchObject({ commitment_date: null, trial_patient_count: null, status: "Unknown", follow_up_outcome: null, evidence: null });
  });
  it("still nulls negative and fractional numbers even with verified evidence", () => {
    const e = normalizeEffectiveness(eff([sample({ quantity: -1 })], [commitment({ trial_patient_count: 2.5 })]), NOTE, known);
    expect(e.samples[0]?.quantity).toBeNull();
    expect(e.commitments[0]?.trial_patient_count).toBeNull();
  });
});

describe("intelligence: minimum evidence length", () => {
  const note = "Valuecor is preferred because it costs less.";
  const competitor = (evidence: string | null) => ({
    original_mention: "Valuecor", brand_discussed: "Valuecor", candidate_ids: [], ambiguous: false,
    sentiment: "Positive" as const, reason_for_preference: "Price advantage" as const, preference_detail: "cheaper", evidence,
  });
  it("accepts verified evidence", () => {
    expect(normalizeIntelligence({ competitors: [competitor(note)], barriers: [] }, note, known).competitors[0]).toMatchObject({ sentiment: "Positive", evidence: note });
  });
  it.each(["a", "is", "Valu"])("treats %j as unverified, so sentiment, reason and detail reset", (evidence) => {
    expect(normalizeIntelligence({ competitors: [competitor(evidence)], barriers: [] }, note, known).competitors[0]).toMatchObject({ sentiment: "Unknown", reason_for_preference: "Unknown", preference_detail: null, evidence: null });
  });
  it("resets a barrier supported only by a trivial quote", () => {
    const barrier = { category: "Price or cost sensitivity" as const, status: "Open" as const, primary: true, evidence: "is", suggested_followup_action: "Send costs" };
    expect(normalizeIntelligence({ competitors: [], barriers: [barrier] }, note, known).barriers[0]).toMatchObject({ category: "Unknown", status: "Unknown", primary: false, evidence: null, suggested_followup_action: null });
  });
});

describe("IST dates", () => {
  it("uses the IST calendar date, not the UTC date, between 00:00 and 05:30 IST", () => {
    const at0230ist = new Date("2026-11-07T21:00:00Z"); // 02:30 IST on 8 Nov
    expect(at0230ist.toISOString().slice(0, 10)).toBe("2026-11-07");
    expect(todayIST(at0230ist)).toBe("2026-11-08");
  });
  it("agrees with UTC outside that window", () => {
    expect(todayIST(new Date("2026-11-07T12:00:00Z"))).toBe("2026-11-07");
    expect(todayIST(new Date("2026-11-07T18:29:59Z"))).toBe("2026-11-07"); // 23:59:59 IST
    expect(todayIST(new Date("2026-11-07T18:30:00Z"))).toBe("2026-11-08"); // 00:00:00 IST
  });
  it("adds days by calendar arithmetic across month, year and leap boundaries", () => {
    expect(addDays("2026-11-08", 7)).toBe("2026-11-15");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-02-30", 1)).toBeNull();
  });
  it("derives the call date from a date-only value or a legacy timestamp in IST", () => {
    expect(effectiveCallDate({ call_date_only: "2026-11-05", call_datetime: null })).toBe("2026-11-05");
    expect(effectiveCallDate({ call_date_only: null, call_datetime: "2026-11-07T20:00:00+00:00" })).toBe("2026-11-08");
    expect(effectiveCallDate({ call_date_only: null, call_datetime: null })).toBeNull();
  });
});

describe("approved-report CSV export", () => {
  const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, status: "approved", call_datetime: null, call_date_only: null, created_at: "2026-11-01T00:00:00+00:00", ...patch });
  it("orders by call date, keeping time-unknown reports in date order instead of first", () => {
    const rows = [
      row("dated-old", { call_datetime: "2026-10-26T05:00:00+00:00" }),
      row("unknown-time-new", { call_date_only: "2026-11-05" }),
      row("dated-mid", { call_datetime: "2026-10-30T05:00:00+00:00", call_date_only: "2026-10-30" }),
      row("no-date", {}),
    ];
    expect(sortForExport(rows).map((r) => r.id)).toEqual(["unknown-time-new", "dated-mid", "dated-old", "no-date"]);
  });
  it("sorts same-day reports by time (known time first when later), then newest created", () => {
    const rows = [
      row("a", { call_date_only: "2026-11-05", created_at: "2026-11-05T10:00:00+00:00" }),
      row("b", { call_date_only: "2026-11-05", call_datetime: "2026-11-05T09:00:00+00:00", created_at: "2026-11-05T08:00:00+00:00" }),
      row("c", { call_date_only: "2026-11-05", call_datetime: "2026-11-05T04:00:00+00:00", created_at: "2026-11-05T09:00:00+00:00" }),
    ];
    expect(sortForExport(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate its input", () => {
    const rows = [row("x", { call_date_only: "2026-01-01" }), row("y", { call_date_only: "2026-02-01" })];
    sortForExport(rows);
    expect(rows.map((r) => r.id)).toEqual(["x", "y"]);
  });
  it("keeps the original columns first and in order, then adds Phase 2/3 columns", () => {
    const header = toExportCsv([]).split(",");
    const base = toCsv([]).split(",");
    expect(header.slice(0, base.length)).toEqual(base);
    expect(header).toEqual([...EXPORT_COLUMNS]);
    expect(header).toEqual(expect.arrayContaining(["competitor_brands", "primary_conversion_barrier", "sample_quantities", "commitment_trial_patient_counts", "hcp_tier", "access_quality", "call_date", "mr_profile_id"]));
  });
  it("flattens intelligence and effectiveness; unknown quantities stay 'Unknown' and aligned", () => {
    const intelligence: Intelligence = {
      competitors: [{ original_mention: "Valuecor", brand_discussed: "Valuecor", candidate_ids: [], ambiguous: false, sentiment: "Positive", reason_for_preference: "Price advantage", preference_detail: null, evidence: "costs less", product_id: null, identity_confirmed: false }],
      barriers: [{ category: "Price or cost sensitivity", status: "Open", primary: true, evidence: "cost is the issue", suggested_followup_action: null }],
    };
    const effectiveness = {
      samples: [
        { product_mention: "Cardiovex", candidate_ids: ["PR-201"], quantity: 10, distribution_status: "Distributed", evidence: "Dropped 10 samples", product_id: "PR-201" },
        { product_mention: "Glucorin", candidate_ids: [], quantity: null, distribution_status: "Planned", evidence: "planned Glucorin samples", product_id: null },
      ],
      collateral: [{ material_type: "Dosage chart", detail: null }],
      commitments: [{ commitment_date: null, trial_patient_count: null, status: "Doctor commitment", follow_up_outcome: null, evidence: "will try it" }],
      hcp_tier: null, access_quality: "Brief interaction",
    };
    const csv = toExportCsv([row("r1", { call_date_only: "2026-11-05", intelligence, effectiveness })]);
    const [head, body] = csv.split("\n");
    const cells = Object.fromEntries(head!.split(",").map((h, i) => [h, body!.split(",")[i]]));
    expect(cells["call_date"]).toBe("2026-11-05");
    expect(cells["competitor_count"]).toBe("1");
    expect(cells["primary_conversion_barrier"]).toBe("Price or cost sensitivity");
    expect(cells["sample_quantities"]).toBe("10; Unknown");
    expect(cells["sample_distribution_statuses"]).toBe("Distributed; Planned");
    expect(cells["collateral_types"]).toBe("Dosage chart");
    expect(cells["commitment_trial_patient_counts"]).toBe("Unknown");
    expect(cells["hcp_tier"]).toBe("");
    expect(cells["access_quality"]).toBe("Brief interaction");
  });
  it("exports legacy reports without Phase 2/3 documents as empty optional columns", () => {
    const [head, body] = toExportCsv([row("old", { call_datetime: "2026-10-26T05:00:00+00:00" })]).split("\n");
    const cells = Object.fromEntries(head!.split(",").map((h, i) => [h, body!.split(",")[i]]));
    expect(cells["competitor_count"]).toBe("0");
    expect(cells["competitor_brands"]).toBe("");
    expect(cells["sample_quantities"]).toBe("");
    expect(cells["access_quality"]).toBe("Unknown");
    expect(cells["call_date"]).toBe("2026-10-26");
  });
  it("still neutralizes spreadsheet formulas in the new columns", () => {
    const intelligence = { competitors: [{ original_mention: "=cmd", brand_discussed: "=cmd|calc", candidate_ids: [], ambiguous: false, sentiment: "Unknown", reason_for_preference: "Unknown", preference_detail: null, evidence: null, product_id: null, identity_confirmed: false }], barriers: [] };
    const csv = toExportCsv([row("f", { call_date_only: "2026-11-05", intelligence })]);
    expect(csv).toContain("'=cmd|calc");
    expect(csv.split("\n")[1]).not.toMatch(/(^|,)=cmd/);
  });
});
