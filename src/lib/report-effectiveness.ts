import { z } from "zod";
import { safeDate, verbatimEvidence } from "./report-rules";

export const SAMPLE_DISTRIBUTION_STATUSES = ["Distributed", "Planned", "Unknown"] as const;
export const COLLATERAL_TYPES = ["Clinical trial reprint", "Product information brochure", "Reminder card", "Dosage chart", "Approved educational material", "Other"] as const;
export const COMMITMENT_STATUSES = ["Doctor commitment", "MR follow-up", "Confirmed product trial", "Prescription conversion", "Unknown"] as const;
export const HCP_TIERS = ["A", "B", "C", "Unclassified"] as const;
export const ACCESS_QUALITIES = ["Detailed face-to-face interaction", "Brief interaction", "Clinic assistant only", "No access", "Unknown"] as const;

const nonNegativeInt = z.number().int().nonnegative().nullable();

// Strict-compatible AI shape: all fields required, unstated values nullable.
export const extractedSampleSchema = z.object({
  product_mention: z.string(),
  candidate_ids: z.array(z.string()),
  quantity: nonNegativeInt.describe("Units actually dropped; null when unstated"),
  distribution_status: z.enum(SAMPLE_DISTRIBUTION_STATUSES),
  evidence: z.string().nullable(),
});
export const extractedCollateralSchema = z.object({
  material_type: z.enum(COLLATERAL_TYPES),
  detail: z.string().nullable(),
});
export const extractedCommitmentSchema = z.object({
  commitment_date: z.string().nullable().describe("YYYY-MM-DD only if stated or clearly derivable"),
  trial_patient_count: nonNegativeInt.describe("Committed trial patients; null when unstated"),
  status: z.enum(COMMITMENT_STATUSES),
  follow_up_outcome: z.string().nullable(),
  evidence: z.string().nullable(),
});

export const sampleSchema = extractedSampleSchema.extend({ product_id: z.string().nullable() });
export const effectivenessSchema = z.object({
  samples: z.array(sampleSchema).max(20),
  collateral: z.array(extractedCollateralSchema).max(20),
  commitments: z.array(extractedCommitmentSchema).max(10),
  hcp_tier: z.enum(HCP_TIERS).nullable(),
  access_quality: z.enum(ACCESS_QUALITIES),
});
export type Effectiveness = z.infer<typeof effectivenessSchema>;
export const emptyEffectiveness = (): Effectiveness => ({ samples: [], collateral: [], commitments: [], hcp_tier: null, access_quality: "Unknown" });
export function readEffectiveness(value: unknown): Effectiveness {
  const parsed = effectivenessSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyEffectiveness();
}

const cleanQuantity = (q: number | null) => (typeof q === "number" && Number.isInteger(q) && q >= 0 ? q : null);

/**
 * Evidence must be an exact quote (at least MIN_EVIDENCE_CHARS long) from the immutable original note.
 * Quantities, dates, counts, statuses and outcomes that depend on it are reset when it is unverified.
 */
export function normalizeEffectiveness(
  value: {
    samples: z.infer<typeof extractedSampleSchema>[];
    collateral: z.infer<typeof extractedCollateralSchema>[];
    commitments: z.infer<typeof extractedCommitmentSchema>[];
    hcp_tier: string | null;
    access_quality: string;
  },
  original: string,
  knownIds: Set<string>,
): Effectiveness {
  const quote = (text: string | null) => verbatimEvidence(text, original);
  return {
    samples: value.samples
      .slice(0, 20)
      .filter((s) => s.product_mention && original.toLowerCase().includes(s.product_mention.toLowerCase()))
      .map((s) => {
        const ids = [...new Set(s.candidate_ids.filter((id) => knownIds.has(id)))];
        const evidence = quote(s.evidence);
        return {
          ...s,
          candidate_ids: ids,
          evidence,
          // A quantity is only kept when its evidence quote is verified; otherwise it is unknown.
          quantity: evidence ? cleanQuantity(s.quantity) : null,
          distribution_status: evidence ? s.distribution_status : "Unknown",
          product_id: ids.length === 1 ? (ids[0] ?? null) : null,
        };
      }),
    collateral: value.collateral.slice(0, 20).map((c) => ({ ...c, detail: c.detail?.trim() || null })),
    commitments: value.commitments.slice(0, 10).map((c) => {
      const evidence = quote(c.evidence);
      return {
        ...c,
        evidence,
        // Dates and counts are only kept when the evidence quote is verified; otherwise unknown (null).
        commitment_date: evidence ? safeDate(c.commitment_date) : null,
        trial_patient_count: evidence ? cleanQuantity(c.trial_patient_count) : null,
        status: evidence ? c.status : "Unknown",
        follow_up_outcome: evidence ? c.follow_up_outcome?.trim() || null : null,
      };
    }),
    hcp_tier: (HCP_TIERS as readonly string[]).includes(value.hcp_tier ?? "") ? (value.hcp_tier as Effectiveness["hcp_tier"]) : null,
    access_quality: (ACCESS_QUALITIES as readonly string[]).includes(value.access_quality) ? (value.access_quality as Effectiveness["access_quality"]) : "Unknown",
  };
}

export function validateEffectiveness(value: Effectiveness, knownIds: Set<string>) {
  for (const s of value.samples) {
    if (s.product_id && !knownIds.has(s.product_id)) throw new Error("Unknown sample product.");
    if (s.quantity !== null && (!Number.isInteger(s.quantity) || s.quantity < 0)) throw new Error("Sample quantity cannot be negative.");
  }
  for (const c of value.commitments) {
    if (c.commitment_date && !safeDate(c.commitment_date)) throw new Error("Invalid commitment date.");
    if (c.trial_patient_count !== null && (!Number.isInteger(c.trial_patient_count) || c.trial_patient_count < 0))
      throw new Error("Trial patient count cannot be negative.");
  }
}
