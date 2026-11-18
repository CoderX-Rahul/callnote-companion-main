// Pure, client-safe CSV export for approved reports: one row per report, Phase 2/3 data flattened
// into analytics-friendly columns. Empty cell = nothing recorded; "Unknown" = recorded but unstated.
import { CSV_COLUMNS, effectiveCallDate, sortForExport, toCsv } from "./report-rules";
import { readIntelligence } from "./report-intelligence";
import { readEffectiveness } from "./report-effectiveness";
import { readPob } from "./pob";

const UNKNOWN = "Unknown";
const known = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? UNKNOWN : String(v));
/** Parallel lists share one order, so the Nth entry of every list in a row describes the same item. */
const list = (items: (string | number | null | undefined)[]) => items.map(known).join("; ");

/** Appended after CSV_COLUMNS so existing consumers keep their column positions. */
export const EXPORT_EXTRA_COLUMNS = [
  "call_date",
  "rep_name",
  "mr_profile_id",
  "organization_id",
  "competitor_count",
  "competitor_brands",
  "competitor_sentiments",
  "competitor_reasons",
  "competitor_identity_confirmed",
  "competitor_evidence",
  "primary_conversion_barrier",
  "primary_barrier_status",
  "barrier_categories",
  "barrier_statuses",
  "barrier_followup_actions",
  "barrier_evidence",
  "sample_product_ids",
  "sample_products",
  "sample_quantities",
  "sample_distribution_statuses",
  "collateral_types",
  "commitment_statuses",
  "commitment_dates",
  "commitment_trial_patient_counts",
  "commitment_outcomes",
  "hcp_tier",
  "access_quality",
  "pob_product_mentions",
  "pob_product_ids",
  "pob_quantities",
  "pob_statuses",
  "pob_scheme_mentions",
  "pob_free_quantities",
  "pob_unit_mrp_snapshots",
  "pob_line_values",
  "pob_stated_unit_prices",
  "pob_evidence",
  "pob_warnings",
] as const;

export const EXPORT_COLUMNS = [...CSV_COLUMNS, ...EXPORT_EXTRA_COLUMNS] as const;

export function flattenReportForExport(row: Record<string, unknown>): Record<string, unknown> {
  const intel = readIntelligence(row["intelligence"]);
  const eff = readEffectiveness(row["effectiveness"]);
  const pob = readPob(row["pob"]);
  const primary = intel.barriers.find((b) => b.primary);
  return {
    ...row,
    call_date: effectiveCallDate(row),
    competitor_count: intel.competitors.length,
    competitor_brands: list(intel.competitors.map((c) => c.brand_discussed || c.original_mention)),
    competitor_sentiments: list(intel.competitors.map((c) => c.sentiment)),
    competitor_reasons: list(intel.competitors.map((c) => c.reason_for_preference)),
    competitor_identity_confirmed: list(intel.competitors.map((c) => (c.identity_confirmed ? "Yes" : "No"))),
    competitor_evidence: list(intel.competitors.map((c) => c.evidence)),
    primary_conversion_barrier: primary?.category ?? "",
    primary_barrier_status: primary?.status ?? "",
    barrier_categories: list(intel.barriers.map((b) => b.category)),
    barrier_statuses: list(intel.barriers.map((b) => b.status)),
    barrier_followup_actions: list(intel.barriers.map((b) => b.suggested_followup_action)),
    barrier_evidence: list(intel.barriers.map((b) => b.evidence)),
    sample_product_ids: list(eff.samples.map((s) => s.product_id)),
    sample_products: list(eff.samples.map((s) => s.product_mention)),
    sample_quantities: list(eff.samples.map((s) => s.quantity)),
    sample_distribution_statuses: list(eff.samples.map((s) => s.distribution_status)),
    collateral_types: list(eff.collateral.map((c) => c.material_type)),
    commitment_statuses: list(eff.commitments.map((c) => c.status)),
    commitment_dates: list(eff.commitments.map((c) => c.commitment_date)),
    commitment_trial_patient_counts: list(eff.commitments.map((c) => c.trial_patient_count)),
    commitment_outcomes: list(eff.commitments.map((c) => c.follow_up_outcome)),
    hcp_tier: eff.hcp_tier ?? "",
    access_quality: eff.access_quality,
    pob_product_mentions: list(pob.lines.map((line) => line.product_mention)),
    pob_product_ids: list(pob.lines.map((line) => line.product_id)),
    pob_quantities: list(pob.lines.map((line) => line.quantity)),
    pob_statuses: list(pob.lines.map((line) => line.status)),
    pob_scheme_mentions: list(pob.lines.map((line) => line.scheme_mention)),
    pob_free_quantities: list(pob.lines.map((line) => line.free_quantity)),
    pob_unit_mrp_snapshots: list(pob.lines.map((line) => line.unit_mrp_snapshot)),
    pob_line_values: list(pob.lines.map((line) => line.line_value)),
    pob_stated_unit_prices: list(pob.lines.map((line) => line.stated_unit_price)),
    pob_evidence: list(pob.lines.map((line) => line.evidence)),
    pob_warnings: list(pob.lines.map((line) => line.warnings.join(", "))),
  };
}

/** Newest call first (time-unknown reports stay in date order), with Phase 2/3 columns. */
export function toExportCsv(rows: Record<string, unknown>[]): string {
  return toCsv(sortForExport(rows).map(flattenReportForExport), EXPORT_COLUMNS);
}
