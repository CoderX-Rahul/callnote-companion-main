import { describe, expect, it } from "vitest";
import {
  computePobLine,
  EXTRACTION_SCHEMA_VERSION,
  normalizePob,
  parseSchemeMention,
  restoreAiStatedPrices,
  rollUpByDirectReport,
  type ProductScheme,
} from "@/lib/pob";
import { extractionSchema } from "@/lib/ai.server";
import { toExportCsv, EXPORT_COLUMNS } from "@/lib/report-export";

const products = [
  { id: "P1", name: "Cardiovex", mrp: "0.05" },
  { id: "P2", name: "Glucorin", mrp: "1.01" },
];
const schemes: ProductScheme[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    product_id: "P1",
    label: "10+1",
    scheme_type: "free_goods",
    buy_qty: 10,
    free_qty: 1,
    discount_pct: null,
    active: true,
    valid_from: null,
    valid_to: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    product_id: "P2",
    label: "5%",
    scheme_type: "discount_percent",
    buy_qty: null,
    free_qty: null,
    discount_pct: "5.00",
    active: true,
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
  },
];

describe("POB calculations and normalization", () => {
  it("bumps the existing extraction schema and includes nullable order fields", () => {
    expect(EXTRACTION_SCHEMA_VERSION).toBe(2);
    expect(
      extractionSchema.shape.pob.parse([
        {
          mention: "Cardiovex",
          candidate_ids: [],
          quantity: null,
          status: "Unknown",
          scheme_mention: null,
          stated_unit_price: null,
          evidence: null,
        },
      ]),
    ).toHaveLength(1);
  });

  it("uses integer paise, half-up rounding, and null for unknown quantity or price", () => {
    expect(computePobLine({ quantity: 1, unitMrp: "1.01", discountPct: 50 }).lineValue).toBe(0.51);
    expect(computePobLine({ quantity: 21, unitMrp: "0.05", buyQty: 10, freeQty: 1 })).toEqual({
      freeQuantity: 2,
      lineValue: 1.05,
    });
    expect(computePobLine({ quantity: null, unitMrp: 20 }).lineValue).toBeNull();
    expect(computePobLine({ quantity: 3, unitMrp: null }).lineValue).toBeNull();
    expect(computePobLine({ quantity: null, unitMrp: 20, buyQty: 10, freeQty: 1 })).toEqual({
      freeQuantity: null,
      lineValue: null,
    });
  });

  it("parses common master scheme expressions", () => {
    expect(parseSchemeMention("10 + 1")).toEqual({
      scheme_type: "free_goods",
      buy_qty: 10,
      free_qty: 1,
    });
    expect(parseSchemeMention("5%")).toEqual({ scheme_type: "discount_percent", discount_pct: 5 });
    expect(parseSchemeMention("special offer")).toBeNull();
  });

  it("keeps only verbatim evidence, known IDs, valid schemes, and recalculated snapshots", () => {
    const note = "Booked 20 Cardiovex with a 10+1 offer at Rs 0.10.";
    const result = normalizePob(
      {
        lines: [
          {
            mention: "Cardiovex",
            candidate_ids: ["P1", "bad"],
            quantity: 20,
            status: "Booked",
            scheme_mention: "10+1",
            stated_unit_price: 0.1,
            evidence: "Booked 20 Cardiovex with a 10+1 offer",
          },
        ],
      },
      note,
      "2026-11-17",
      products,
      schemes,
    );
    expect(result.lines[0]).toMatchObject({
      product_id: "P1",
      candidate_ids: ["P1"],
      quantity: 20,
      status: "Booked",
      scheme_id: schemes[0]?.id,
      free_quantity: 2,
      unit_mrp_snapshot: 0.05,
      line_value: 1,
      warnings: ["Stated unit price differs from MRP"],
    });
    const invalidEvidence = normalizePob(
      {
        lines: [
          {
            mention: "Glucorin",
            candidate_ids: ["P2"],
            quantity: 10,
            status: "Booked",
            scheme_mention: null,
            stated_unit_price: 12,
            evidence: "invented quote",
          },
        ],
      },
      note,
      "2026-11-17",
      products,
      schemes,
    );
    expect(invalidEvidence.lines[0]).toMatchObject({
      quantity: null,
      status: "Unknown",
      stated_unit_price: null,
      evidence: null,
      line_value: null,
    });
  });

  it("flags missing, ambiguous and date-invalid scheme matches", () => {
    const line = {
      mention: "Glucorin",
      candidate_ids: ["P2"],
      quantity: 10,
      status: "Booked" as const,
      scheme_mention: "5%",
      stated_unit_price: null,
      evidence: "Booked 10 Glucorin at 5%",
    };
    expect(
      normalizePob({ lines: [line] }, line.evidence!, "2026-11-17", products, schemes).lines[0]
        ?.warnings,
    ).toEqual([]);
    expect(
      normalizePob({ lines: [line] }, line.evidence!, "2027-01-01", products, schemes).lines[0]
        ?.warnings,
    ).toContain("scheme not in master");
    expect(
      normalizePob({ lines: [line] }, line.evidence!, "2026-11-17", products, [
        schemes[1]!,
        { ...schemes[1]!, id: "33333333-3333-4333-8333-333333333333" },
      ]).lines[0]?.warnings,
    ).toContain("Ambiguous scheme match");
  });

  it("ignores browser-supplied stated prices and restores only an immutable AI value", () => {
    const base = normalizePob(
      {
        lines: [
          {
            mention: "Glucorin",
            candidate_ids: ["P2"],
            quantity: 10,
            status: "Booked",
            scheme_mention: null,
            stated_unit_price: 12,
            evidence: "Booked 10 Glucorin",
          },
        ],
      },
      "Booked 10 Glucorin",
      "2026-11-17",
      products,
      schemes,
    );
    const tampered = { lines: base.lines.map((line) => ({ ...line, stated_unit_price: 999 })) };
    expect(restoreAiStatedPrices(tampered, base).lines[0]?.stated_unit_price).toBe(12);
    expect(restoreAiStatedPrices(tampered, { lines: [] }).lines[0]?.stated_unit_price).toBeNull();
  });

  it("rolls descendants into direct-report rows and isolates MR to self", () => {
    const rows = [
      { id: "n", reports_to: null, role: "nsm", full_name: "NSM", employee_code: "N" },
      { id: "a", reports_to: "n", role: "asm", full_name: "Area A", employee_code: "A" },
      { id: "m", reports_to: "a", role: "mr", full_name: "MR A", employee_code: "M" },
      { id: "u", reports_to: null, role: "mr", full_name: "Unassigned MR", employee_code: "U" },
    ];
    const totals = {
      a: { approved_calls: 1, booked_calls: 1, booked_lines: 1, booked_value: 10 },
      m: { approved_calls: 2, booked_calls: 1, booked_lines: 2, booked_value: 20 },
      u: { approved_calls: 3, booked_calls: 0, booked_lines: 0, booked_value: 0 },
    };
    expect(rollUpByDirectReport(rows[0]!, rows, totals)).toMatchObject([
      {
        label: "ASM · Area A",
        approved_calls: 3,
        booked_calls: 2,
        booked_lines: 3,
        booked_value: 30,
      },
      { label: "Unassigned", approved_calls: 3 },
    ]);
    expect(rollUpByDirectReport(rows[2]!, rows, totals)[0]).toMatchObject({
      label: "My POB",
      approved_calls: 2,
    });
  });
});

it("appends POB parallel lists to CSV and keeps formula protection", () => {
  const csv = toExportCsv([
    {
      call_date: "2026-11-17",
      pob: {
        lines: [
          {
            product_mention: "=cmd",
            candidate_ids: [],
            product_id: null,
            quantity: 5,
            scheme_mention: "10+1",
            scheme_id: null,
            status: "Booked",
            free_quantity: 0,
            unit_mrp_snapshot: 10,
            discount_pct_snapshot: null,
            line_value: 50,
            stated_unit_price: null,
            evidence: "Booked product",
            warnings: [],
          },
        ],
      },
    },
  ]);
  expect(EXPORT_COLUMNS).toContain("pob_line_values");
  expect(csv.split("\n")[1]).toContain(",5,Booked,");
  expect(csv).toContain("'=cmd");
});
