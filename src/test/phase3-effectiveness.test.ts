import { describe, expect, it } from "vitest";
import {
  emptyEffectiveness, normalizeEffectiveness, readEffectiveness, validateEffectiveness,
  type Effectiveness,
} from "@/lib/report-effectiveness";

const NOTE = "Met Dr. Rao yesterday. Dropped 10 samples of Cardiovex and planned Nurocalm samples for next week. Left the dosage chart and a reminder card. He committed to try Cardiovex on 5 patients by 15 Nov 2026. Tier B doctor, brief interaction.";
const PRODUCTS = new Set(["PR-201", "PR-202"]);

const base = {
  samples: [
    { product_mention: "Cardiovex", candidate_ids: ["PR-201"], quantity: 10, distribution_status: "Distributed" as const, evidence: "Dropped 10 samples of Cardiovex" },
    { product_mention: "Nurocalm", candidate_ids: ["PR-202"], quantity: null, distribution_status: "Planned" as const, evidence: "planned Nurocalm samples for next week" },
  ],
  collateral: [
    { material_type: "Dosage chart" as const, detail: null },
    { material_type: "Reminder card" as const, detail: null },
  ],
  commitments: [
    { commitment_date: "2026-11-15", trial_patient_count: 5, status: "Doctor commitment" as const, follow_up_outcome: null, evidence: "committed to try Cardiovex on 5 patients by 15 Nov 2026" },
  ],
  hcp_tier: "B",
  access_quality: "Brief interaction",
};

describe("phase 3 field effectiveness normalization", () => {
  it("keeps multiple sample products with distributed vs planned status", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    expect(e.samples).toHaveLength(2);
    expect(e.samples[0]).toMatchObject({ product_id: "PR-201", quantity: 10, distribution_status: "Distributed" });
    expect(e.samples[1]).toMatchObject({ product_id: "PR-202", quantity: null, distribution_status: "Planned" });
  });

  it("keeps unknown quantities null and never fabricates numbers", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    expect(e.samples[1]?.quantity).toBeNull();
  });

  it("rejects negative or fractional quantities by nulling them", () => {
    const bad = { ...base, samples: [{ ...base.samples[0]!, quantity: -3 }, { ...base.samples[0]!, quantity: 2.5 }] };
    const e = normalizeEffectiveness(bad, NOTE, PRODUCTS);
    expect(e.samples.map((s) => s.quantity)).toEqual([null, null]);
  });

  it("drops sample mentions that are not in the original note", () => {
    const invented = { ...base, samples: [{ ...base.samples[0]!, product_mention: "Zyprexa" }] };
    expect(normalizeEffectiveness(invented, NOTE, PRODUCTS).samples).toHaveLength(0);
  });

  it("keeps multiple collateral items", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    expect(e.collateral.map((c) => c.material_type)).toEqual(["Dosage chart", "Reminder card"]);
  });

  it("keeps a doctor commitment distinct from a prescription conversion", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    expect(e.commitments[0]?.status).toBe("Doctor commitment");
    expect(e.commitments[0]?.trial_patient_count).toBe(5);
    expect(e.commitments[0]?.commitment_date).toBe("2026-11-15");
  });

  it("marks commitment status and outcome Unknown without verbatim evidence", () => {
    const noEvidence = { ...base, commitments: [{ ...base.commitments[0]!, evidence: "not in the note" }] };
    const e = normalizeEffectiveness(noEvidence, NOTE, PRODUCTS);
    expect(e.commitments[0]?.status).toBe("Unknown");
    expect(e.commitments[0]?.follow_up_outcome).toBeNull();
  });

  it("records an explicitly stated tier but never infers one", () => {
    expect(normalizeEffectiveness(base, NOTE, PRODUCTS).hcp_tier).toBe("B");
    expect(normalizeEffectiveness({ ...base, hcp_tier: null }, NOTE, PRODUCTS).hcp_tier).toBeNull();
    expect(normalizeEffectiveness({ ...base, hcp_tier: "A+" }, NOTE, PRODUCTS).hcp_tier).toBeNull();
  });

  it("keeps access quality separate from tier and defaults to Unknown", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    expect(e.access_quality).toBe("Brief interaction");
    expect(normalizeEffectiveness({ ...base, access_quality: "Excellent" }, NOTE, PRODUCTS).access_quality).toBe("Unknown");
  });

  it("reads historical reports without effectiveness as empty and optional", () => {
    const e = readEffectiveness(null);
    expect(e).toEqual(emptyEffectiveness());
    expect(() => validateEffectiveness(e, PRODUCTS)).not.toThrow();
  });

  it("rejects unknown sample product ids and negative quantities on save", () => {
    const e = normalizeEffectiveness(base, NOTE, PRODUCTS);
    const badProduct: Effectiveness = { ...e, samples: [{ ...e.samples[0]!, product_id: "PR-999" }] };
    expect(() => validateEffectiveness(badProduct, PRODUCTS)).toThrow("Unknown sample product");
    const badQty: Effectiveness = { ...e, samples: [{ ...e.samples[0]!, quantity: -1 }] };
    expect(() => validateEffectiveness(badQty, PRODUCTS)).toThrow("negative");
  });
});
