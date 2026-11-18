import { z } from "zod";
import { verbatimEvidence } from "./report-rules";

export const SENTIMENTS = ["Positive", "Negative", "Neutral", "Mixed", "Unknown"] as const;
export const PREFERENCE_REASONS = ["Price advantage", "Clinical evidence", "Brand loyalty", "Availability", "Efficacy feedback", "Tolerability feedback", "Promotional activity", "Other", "Unknown"] as const;
export const BARRIER_CATEGORIES = ["Price or cost sensitivity", "Insufficient clinical evidence or trust", "Stock or availability issues", "Existing brand loyalty", "Patient affordability", "Product awareness gap", "Doctor not convinced", "Other", "Unknown", "Not discussed"] as const;
export const BARRIER_STATUSES = ["Open", "Resolved", "Not discussed", "Unknown"] as const;

// Strict-compatible AI shape: all fields required, unstated values nullable.
export const extractedCompetitorSchema = z.object({
  original_mention: z.string(), brand_discussed: z.string().nullable(),
  candidate_ids: z.array(z.string()), ambiguous: z.boolean(),
  sentiment: z.enum(SENTIMENTS), reason_for_preference: z.enum(PREFERENCE_REASONS),
  preference_detail: z.string().nullable(), evidence: z.string().nullable(),
});
export const extractedBarrierSchema = z.object({
  category: z.enum(BARRIER_CATEGORIES), status: z.enum(BARRIER_STATUSES),
  primary: z.boolean(), evidence: z.string().nullable(), suggested_followup_action: z.string().nullable(),
});
export const competitorSchema = extractedCompetitorSchema.extend({
  product_id: z.string().nullable(), identity_confirmed: z.boolean(),
});
export const intelligenceSchema = z.object({
  competitors: z.array(competitorSchema).max(20), barriers: z.array(extractedBarrierSchema).max(20),
});
export type Intelligence = z.infer<typeof intelligenceSchema>;
export const emptyIntelligence = (): Intelligence => ({ competitors: [], barriers: [] });
export function readIntelligence(value: unknown): Intelligence {
  const parsed = intelligenceSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyIntelligence();
}

/** Evidence must be an exact quote (at least MIN_EVIDENCE_CHARS long) from the immutable original note. */
export function normalizeIntelligence(
  value: { competitors: z.infer<typeof extractedCompetitorSchema>[]; barriers: z.infer<typeof extractedBarrierSchema>[] },
  original: string, knownIds: Set<string>,
): Intelligence {
  const quote = (text: string | null) => verbatimEvidence(text, original);
  let hasPrimary = false;
  return {
    competitors: value.competitors.slice(0, 20).filter((c) => c.original_mention && original.toLowerCase().includes(c.original_mention.toLowerCase())).map((c) => {
      const ids = [...new Set(c.candidate_ids.filter((id) => knownIds.has(id)))];
      const evidence = quote(c.evidence);
      const ambiguous = c.ambiguous || ids.length > 1;
      return { ...c, candidate_ids: ids, ambiguous, evidence,
        sentiment: evidence ? c.sentiment : "Unknown", reason_for_preference: evidence ? c.reason_for_preference : "Unknown",
        preference_detail: evidence ? c.preference_detail : null,
        product_id: !ambiguous && ids.length === 1 ? ids[0] ?? null : null,
        identity_confirmed: !ambiguous && ids.length === 1,
      };
    }),
    barriers: value.barriers.slice(0, 20).map((b) => {
      const evidence = quote(b.evidence);
      const primary = !!evidence && b.primary && !hasPrimary;
      if (primary) hasPrimary = true;
      return { ...b, evidence, primary, category: evidence ? b.category : "Unknown", status: evidence ? b.status : "Unknown", suggested_followup_action: evidence ? b.suggested_followup_action : null };
    }),
  };
}

export function validateIntelligence(value: Intelligence, knownIds: Set<string>) {
  if (value.barriers.filter((b) => b.primary).length > 1) throw new Error("Choose only one primary barrier.");
  for (const c of value.competitors) {
    if (c.product_id && !knownIds.has(c.product_id)) throw new Error("Unknown competitor product.");
    if (c.product_id && !c.identity_confirmed) throw new Error("Confirm the competitor identity or leave it unknown.");
    if (c.ambiguous && c.identity_confirmed && !c.product_id && !c.brand_discussed?.trim()) throw new Error("Enter the confirmed competitor brand or leave it unknown.");
  }
}