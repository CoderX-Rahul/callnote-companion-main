import { describe, expect, it } from "vitest";
import { emptyIntelligence, normalizeIntelligence, readIntelligence, validateIntelligence, type Intelligence } from "@/lib/report-intelligence";
import { missingRequired } from "@/lib/report-rules";

const competitor = (patch: Partial<Intelligence["competitors"][number]> = {}): Intelligence["competitors"][number] => ({ original_mention: "Valuecor", brand_discussed: "Valuecor", candidate_ids: [], ambiguous: false, sentiment: "Unknown", reason_for_preference: "Unknown", preference_detail: null, evidence: null, product_id: null, identity_confirmed: false, ...patch });
const known = new Set(["PR-201", "PR-202"]);
describe("Phase 2 intelligence", () => {
  it("preserves old reports and no-competitor notes as empty optional intelligence", () => {
    expect(readIntelligence(undefined)).toEqual(emptyIntelligence());
    expect(normalizeIntelligence(emptyIntelligence(), "Routine detailing visit", known)).toEqual(emptyIntelligence());
  });
  it("captures one explicit positive price preference without inventing master identity", () => {
    const note = "Valuecor is preferred because it costs less.";
    const result = normalizeIntelligence({ competitors: [competitor({ sentiment: "Positive", reason_for_preference: "Price advantage", evidence: note })], barriers: [] }, note, known);
    expect(result.competitors[0]).toMatchObject({ sentiment: "Positive", reason_for_preference: "Price advantage", evidence: note, product_id: null, identity_confirmed: false });
  });
  it("preserves multiple competitors with separate positive clinical and negative tolerability evidence", () => {
    const positive = "Trialcor has stronger clinical evidence.";
    const negative = "Valuecor caused tolerability concerns.";
    const result = normalizeIntelligence({ competitors: [competitor({ original_mention: "Trialcor", brand_discussed: "Trialcor", sentiment: "Positive", reason_for_preference: "Clinical evidence", evidence: positive }), competitor({ sentiment: "Negative", reason_for_preference: "Tolerability feedback", evidence: negative })], barriers: [] }, positive + " " + negative, known);
    expect(result.competitors.map((c) => [c.sentiment, c.reason_for_preference])).toEqual([["Positive", "Clinical evidence"], ["Negative", "Tolerability feedback"]]);
  });
  it("requires human confirmation for ambiguous master identities", () => {
    const result = normalizeIntelligence({ competitors: [competitor({ original_mention: "Cardiovex", candidate_ids: ["PR-201", "PR-202", "invented"] })], barriers: [] }, "Discussed Cardiovex as an alternative", known);
    expect(result.competitors[0]).toMatchObject({ candidate_ids: ["PR-201", "PR-202"], ambiguous: true, product_id: null, identity_confirmed: false });
    expect(() => validateIntelligence({ ...result, competitors: result.competitors.map((c) => ({ ...c, product_id: "PR-201" })) }, known)).toThrow("Confirm");
    expect(() => validateIntelligence({ ...result, competitors: result.competitors.map((c) => ({ ...c, product_id: "PR-201", identity_confirmed: true })) }, known)).not.toThrow();
  });
  it("preserves uncertain statements as Unknown and removes fabricated evidence and sentiments", () => {
    const note = "Maybe Valuecor was mentioned, not sure.";
    const result = normalizeIntelligence({ competitors: [competitor({ ambiguous: true, evidence: note }), competitor({ sentiment: "Positive", reason_for_preference: "Price advantage", evidence: "Valuecor is cheaper" })], barriers: [] }, note, known);
    expect(result.competitors[0]).toMatchObject({ sentiment: "Unknown", ambiguous: true, evidence: note });
    expect(result.competitors[1]).toMatchObject({ sentiment: "Unknown", reason_for_preference: "Unknown", evidence: null });
  });
  it("preserves Neutral and Mixed when explicitly supported", () => {
    for (const sentiment of ["Neutral", "Mixed"] as const) {
      const note = "Valuecor was discussed.";
      expect(normalizeIntelligence({ competitors: [competitor({ sentiment, evidence: note })], barriers: [] }, note, known).competitors[0]?.sentiment).toBe(sentiment);
    }
  });
  it("captures multiple pricing/clinical barriers and only one primary", () => {
    const result = normalizeIntelligence({ competitors: [], barriers: [
      { category: "Price or cost sensitivity", status: "Open", primary: true, evidence: "Cost is the main obstacle.", suggested_followup_action: "Send the cost summary." },
      { category: "Insufficient clinical evidence or trust", status: "Open", primary: true, evidence: "Needs trial evidence.", suggested_followup_action: null },
    ] }, "Cost is the main obstacle. Needs trial evidence. Send the cost summary.", known);
    expect(result.barriers.map((b) => [b.category, b.primary])).toEqual([["Price or cost sensitivity", true], ["Insufficient clinical evidence or trust", false]]);
    expect(result.barriers[1]?.suggested_followup_action).toBeNull();
    expect(() => validateIntelligence({ ...result, barriers: result.barriers.map((b) => ({ ...b, primary: true })) }, known)).toThrow("one primary");
  });
  it("does not infer barriers without evidence", () => {
    expect(normalizeIntelligence({ competitors: [], barriers: [{ category: "Existing brand loyalty", status: "Open", primary: true, evidence: "made up", suggested_followup_action: "invented" }] }, "Routine visit", known).barriers[0]).toMatchObject({ category: "Unknown", status: "Unknown", evidence: null, primary: false, suggested_followup_action: null });
  });
  it("does not block approval for missing or unresolved optional intelligence", () => {
    const fields = { doctor_id: "DR-1001", call_date_only: "2026-11-02", call_datetime: null, product_ids: ["PR-201"], purpose: "Detailing" };
    expect(missingRequired(fields)).toEqual([]);
    expect(() => validateIntelligence({ competitors: [competitor({ ambiguous: true, brand_discussed: null })], barriers: [] }, known)).not.toThrow();
  });
});