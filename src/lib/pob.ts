import { z } from "zod";
import { safeDate, verbatimEvidence } from "./report-rules";

export const EXTRACTION_SCHEMA_VERSION = 2;
export const POB_STATUSES = ["Booked", "Tentative", "Unknown"] as const;

export const extractedPobLineSchema = z.object({
  mention: z.string(),
  candidate_ids: z.array(z.string()),
  quantity: z.number().int().nonnegative().max(999_999_999).nullable(),
  status: z.enum(POB_STATUSES),
  scheme_mention: z.string().nullable(),
  stated_unit_price: z.number().nonnegative().max(99_999_999.99).nullable(),
  evidence: z.string().nullable(),
});
export type ExtractedPobLine = z.infer<typeof extractedPobLineSchema>;

export const pobLineSchema = z.object({
  product_mention: z.string(),
  candidate_ids: z.array(z.string()),
  product_id: z.string().nullable(),
  quantity: z.number().int().nonnegative().max(999_999_999).nullable(),
  scheme_mention: z.string().nullable(),
  scheme_id: z.string().uuid().nullable(),
  status: z.enum(POB_STATUSES),
  free_quantity: z.number().int().nonnegative().nullable(),
  unit_mrp_snapshot: z.number().nonnegative().nullable(),
  discount_pct_snapshot: z.number().min(0).max(100).nullable(),
  line_value: z.number().nonnegative().nullable(),
  stated_unit_price: z.number().nonnegative().nullable(),
  evidence: z.string().nullable(),
  warnings: z.array(z.string()),
});
export const pobSchema = z.object({ lines: z.array(pobLineSchema).max(30) });
export type PobLine = z.infer<typeof pobLineSchema>;
export type PobDocument = z.infer<typeof pobSchema>;

export type ProductForPob = {
  id: string;
  name: string;
  mrp: number | string | null;
  category?: string | null;
};
export type ProductScheme = {
  id: string;
  product_id: string;
  label: string;
  scheme_type: "free_goods" | "discount_percent";
  buy_qty: number | null;
  free_qty: number | null;
  discount_pct: number | string | null;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
};

export function emptyPob(): PobDocument {
  return { lines: [] };
}

function decimalMinorUnits(value: number | string | null | undefined): bigint | null {
  if (value == null || value === "") return null;
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > 2) return null;
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function amountFromMinor(minor: bigint): number {
  return Number(minor) / 100;
}

/** Computes INR using integer paise throughout; percentage fractions round half-up. */
export function computePobLine(input: {
  quantity: number | null;
  unitMrp: number | string | null;
  discountPct?: number | string | null;
  buyQty?: number | null;
  freeQty?: number | null;
}) {
  const pricePaise = decimalMinorUnits(input.unitMrp);
  const q = input.quantity;
  const discountPaise = decimalMinorUnits(input.discountPct ?? 0);
  const discountBasisPoints = discountPaise;
  const hasFreeGoodsScheme =
    input.buyQty != null && input.buyQty > 0 && input.freeQty != null && input.freeQty > 0;
  const freeQuantity = hasFreeGoodsScheme
    ? q !== null && Number.isInteger(q) && q >= 0
      ? Math.floor(q / input.buyQty!) * input.freeQty!
      : null
    : 0;
  if (
    pricePaise === null ||
    q === null ||
    !Number.isInteger(q) ||
    q < 0 ||
    discountBasisPoints === null
  ) {
    return { freeQuantity, lineValue: null };
  }
  const grossPaise = BigInt(q) * pricePaise;
  const discount = BigInt(discountBasisPoints);
  const netPaise = (grossPaise * (10_000n - discount) + 5_000n) / 10_000n;
  if (netPaise > 999_999_999_999n) return { freeQuantity, lineValue: null };
  return { freeQuantity, lineValue: amountFromMinor(netPaise) };
}

export type ParsedSchemeMention =
  | { scheme_type: "free_goods"; buy_qty: number; free_qty: number }
  | { scheme_type: "discount_percent"; discount_pct: number };

export function parseSchemeMention(value: string | null | undefined): ParsedSchemeMention | null {
  if (!value) return null;
  const text = value.trim().replace(/\s+/g, "");
  const free = /^(\d{1,6})\+(\d{1,6})$/.exec(text);
  if (free)
    return { scheme_type: "free_goods", buy_qty: Number(free[1]), free_qty: Number(free[2]) };
  const pct = /^(\d{1,3}(?:\.\d{1,2})?)%$/.exec(text);
  if (pct && Number(pct[1]) > 0 && Number(pct[1]) <= 100)
    return { scheme_type: "discount_percent", discount_pct: Number(pct[1]) };
  return null;
}

export function readPob(value: unknown): PobDocument {
  const parsed = pobSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyPob();
}

/** Browser input cannot replace extracted prices; retain only the immutable AI snapshot value. */
export function restoreAiStatedPrices(value: PobDocument, aiSnapshot: unknown): PobDocument {
  const trusted = readPob(aiSnapshot);
  return {
    lines: value.lines.map((line) => {
      const source = trusted.lines.find(
        (candidate) =>
          candidate.product_mention === line.product_mention &&
          candidate.evidence === line.evidence,
      );
      return { ...line, stated_unit_price: source?.stated_unit_price ?? null };
    }),
  };
}

function isSchemeValid(scheme: ProductScheme, date: string | null) {
  return (
    !!date &&
    scheme.active &&
    (!scheme.valid_from || scheme.valid_from <= date) &&
    (!scheme.valid_to || scheme.valid_to >= date)
  );
}

export function normalizePob(
  input: { lines: Array<Partial<PobLine> & Partial<ExtractedPobLine>> },
  originalNote: string,
  callDate: string | null,
  products: ProductForPob[],
  schemes: ProductScheme[],
): PobDocument {
  const productById = new Map(products.map((p) => [p.id, p]));
  const date = safeDate(callDate);
  const lines = input.lines.slice(0, 30).map((raw) => {
    const mention =
      String(raw.product_mention ?? raw.mention ?? "")
        .trim()
        .slice(0, 200) || "Unknown product";
    const candidateIds = [
      ...new Set(
        (raw.candidate_ids ?? []).filter(
          (id): id is string => typeof id === "string" && productById.has(id),
        ),
      ),
    ];
    const requestedId =
      typeof raw.product_id === "string" && productById.has(raw.product_id) ? raw.product_id : null;
    const productId = requestedId ?? (candidateIds.length === 1 ? (candidateIds[0] ?? null) : null);
    const product = productId ? productById.get(productId) : null;
    const evidence = verbatimEvidence(raw.evidence, originalNote);
    const numericEvidence = !!evidence;
    const quantity =
      numericEvidence &&
      typeof raw.quantity === "number" &&
      Number.isInteger(raw.quantity) &&
      raw.quantity >= 0 &&
      raw.quantity <= 999_999_999
        ? raw.quantity
        : null;
    const statedUnitPrice =
      numericEvidence &&
      typeof raw.stated_unit_price === "number" &&
      Number.isFinite(raw.stated_unit_price) &&
      raw.stated_unit_price >= 0 &&
      raw.stated_unit_price <= 99_999_999.99
        ? amountFromMinor(decimalMinorUnits(raw.stated_unit_price) ?? 0n)
        : null;
    const status = numericEvidence ? (raw.status ?? "Unknown") : "Unknown";
    const schemeMention =
      typeof raw.scheme_mention === "string" && raw.scheme_mention.trim()
        ? raw.scheme_mention.trim().slice(0, 120)
        : null;
    const parsedMention = parseSchemeMention(schemeMention);
    const eligible =
      productId && parsedMention
        ? schemes.filter(
            (scheme) =>
              scheme.product_id === productId &&
              isSchemeValid(scheme, date) &&
              (parsedMention.scheme_type === "free_goods"
                ? scheme.scheme_type === "free_goods" &&
                  scheme.buy_qty === parsedMention.buy_qty &&
                  scheme.free_qty === parsedMention.free_qty
                : scheme.scheme_type === "discount_percent" &&
                  Number(scheme.discount_pct) === parsedMention.discount_pct),
          )
        : [];
    const selectedId =
      typeof raw.scheme_id === "string" && eligible.some((scheme) => scheme.id === raw.scheme_id)
        ? raw.scheme_id
        : eligible.length === 1
          ? (eligible[0]?.id ?? null)
          : null;
    const selected = eligible.find((scheme) => scheme.id === selectedId) ?? null;
    const calculation = computePobLine({
      quantity,
      unitMrp: product?.mrp ?? null,
      discountPct: selected?.scheme_type === "discount_percent" ? selected.discount_pct : null,
      buyQty: selected?.scheme_type === "free_goods" ? selected.buy_qty : null,
      freeQty: selected?.scheme_type === "free_goods" ? selected.free_qty : null,
    });
    const warnings: string[] = [];
    if (schemeMention && !parsedMention) warnings.push("Unrecognized scheme mention");
    else if (schemeMention && eligible.length === 0) warnings.push("scheme not in master");
    else if (eligible.length > 1 && !selectedId) warnings.push("Ambiguous scheme match");
    if (
      statedUnitPrice !== null &&
      product?.mrp != null &&
      Math.abs(statedUnitPrice - Number(product.mrp)) >= 0.01
    )
      warnings.push("Stated unit price differs from MRP");
    return {
      product_mention: mention,
      candidate_ids: candidateIds,
      product_id: productId,
      quantity,
      scheme_mention: schemeMention,
      scheme_id: selectedId,
      status,
      free_quantity:
        parsedMention?.scheme_type === "free_goods" && !selected ? null : calculation.freeQuantity,
      unit_mrp_snapshot: product?.mrp == null ? null : Number(product.mrp),
      discount_pct_snapshot:
        selected?.scheme_type === "discount_percent" ? Number(selected.discount_pct) : null,
      line_value: calculation.lineValue,
      stated_unit_price: statedUnitPrice,
      evidence,
      warnings,
    } satisfies PobLine;
  });
  return { lines };
}

export type PobTotals = {
  approved_calls: number;
  booked_calls: number;
  booked_lines: number;
  booked_value: number | null;
};
export type HierarchyRow = {
  id: string;
  reports_to: string | null;
  role: string;
  full_name: string;
  employee_code: string | null;
};
export type PobRollupRow = PobTotals & { profile_id: string | null; label: string; role: string };

const ZERO: PobTotals = { approved_calls: 0, booked_calls: 0, booked_lines: 0, booked_value: 0 };
function addTotals(target: PobTotals, value: PobTotals) {
  target.approved_calls += value.approved_calls;
  target.booked_calls += value.booked_calls;
  target.booked_lines += value.booked_lines;
  target.booked_value =
    target.booked_value === null || value.booked_value === null
      ? null
      : target.booked_value + value.booked_value;
}

export function rollUpByDirectReport(
  viewer: HierarchyRow,
  hierarchyRows: HierarchyRow[],
  totalsByProfile: Map<string, PobTotals> | Record<string, PobTotals>,
): PobRollupRow[] {
  const totals =
    totalsByProfile instanceof Map ? totalsByProfile : new Map(Object.entries(totalsByProfile));
  const inTree = new Set<string>([viewer.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of hierarchyRows)
      if (row.reports_to && inTree.has(row.reports_to) && !inTree.has(row.id)) {
        inTree.add(row.id);
        changed = true;
      }
  }
  const direct = hierarchyRows.filter((row) => row.reports_to === viewer.id);
  if (viewer.role === "mr")
    return [
      {
        profile_id: viewer.id,
        label: "My POB",
        role: "mr",
        ...{ ...(totals.get(viewer.id) ?? ZERO) },
      },
    ];
  const output: PobRollupRow[] = direct.map((child) => {
    const subtree = new Set<string>([child.id]);
    let hasChild = true;
    while (hasChild) {
      hasChild = false;
      for (const row of hierarchyRows)
        if (row.reports_to && subtree.has(row.reports_to) && !subtree.has(row.id)) {
          subtree.add(row.id);
          hasChild = true;
        }
    }
    const sum = { ...ZERO };
    for (const id of subtree) addTotals(sum, totals.get(id) ?? ZERO);
    const labels: Record<string, string> = {
      asm: "ASM",
      rsm: "RSM",
      zsm: "ZSM",
      nsm: "NSM",
      admin: "Admin",
      manager: "Manager",
      mr: "MR",
    };
    return {
      profile_id: child.id,
      label: `${labels[child.role] ?? child.role} · ${child.full_name}`,
      role: child.role,
      ...sum,
    };
  });
  const assigned = new Set<string>([viewer.id]);
  for (const id of inTree) assigned.add(id);
  const unassigned = hierarchyRows.filter((row) => !assigned.has(row.id));
  if (unassigned.length) {
    const sum = { ...ZERO };
    for (const row of unassigned) addTotals(sum, totals.get(row.id) ?? ZERO);
    output.push({ profile_id: null, label: "Unassigned", role: "unassigned", ...sum });
  }
  return output;
}
