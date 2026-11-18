// Pure, client-safe rules shared by server and UI.

export type ReportFields = {
  call_datetime: string | null;
  call_date_only: string | null;
  doctor_id: string | null;
  product_ids: string[];
  purpose: string | null;
  feedback: string | null;
  materials_requested: string | null;
  follow_up_action: string | null;
  follow_up_due: string | null;
};

export const EDITABLE_FIELDS = [
  "call_datetime",
  "call_date_only",
  "doctor_id",
  "product_ids",
  "purpose",
  "feedback",
  "materials_requested",
  "follow_up_action",
  "follow_up_due",
  "pob",
] as const;

/** Returns human-readable list of missing required fields. Empty = can approve. */
export function missingRequired(r: Pick<ReportFields, "call_datetime" | "doctor_id" | "product_ids" | "purpose"> & { call_date_only?: string | null }) {
  const missing: string[] = [];
  if (!r.doctor_id) missing.push("Doctor");
  if (!safeDate(r.call_date_only) && !dateFromCallDatetime(r.call_datetime)) missing.push("Call date");
  if (!r.product_ids || r.product_ids.length === 0) missing.push("Products discussed");
  if (!r.purpose || !r.purpose.trim()) missing.push("Purpose of visit");
  return missing;
}

/** Keep only IDs that exist in master data — the AI may never introduce new ones. */
export function filterKnownIds(ids: string[], known: Set<string>) {
  return Array.from(new Set(ids.filter((id) => known.has(id))));
}

/** Validates a YYYY-MM-DD string; returns null if not a real date. */
export function safeDate(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function combineDateTime(date: string | null, time: string | null): string | null {
  const d = safeDate(date);
  if (!d) return null;
  // A call datetime needs a time; if absent we keep it unknown rather than inventing one.
  if (!time || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${d}T${time}:00+05:30`;
}

export function dateFromCallDatetime(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !safeDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Evidence quotes shorter than this ("a", "ok") are too weak to count as verification against the note. */
export const MIN_EVIDENCE_CHARS = 5;

/**
 * Returns the trimmed quote only if it is long enough and appears verbatim in the immutable
 * original note; otherwise null. Callers must treat null as "unverified" and reset every
 * value that depended on that evidence.
 */
export function verbatimEvidence(text: string | null | undefined, original: string): string | null {
  const quote = text?.trim();
  return quote && quote.length >= MIN_EVIDENCE_CHARS && original.includes(quote) ? quote : null;
}

/** Today's calendar date (YYYY-MM-DD) in Asia/Kolkata; the UTC date lags IST between 00:00 and 05:30. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Pure calendar arithmetic on a YYYY-MM-DD string; null for an invalid input date. */
export function addDays(date: string, days: number): string | null {
  const d = safeDate(date);
  if (!d) return null;
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const asText = (v: unknown) => (typeof v === "string" ? v : null);

/** The call's calendar date: the stored date-only value, else the IST date of a legacy timestamp. */
export function effectiveCallDate(r: { call_date_only?: unknown; call_datetime?: unknown }): string | null {
  return safeDate(asText(r.call_date_only)) ?? dateFromCallDatetime(asText(r.call_datetime));
}

function descNullsLast<V extends string | number>(a: V | null, b: V | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/**
 * Newest call first by calendar date. Reports with an unknown time stay in date order
 * (a SQL ORDER BY call_datetime DESC would put every NULL time first); unknown dates go last.
 */
export function sortForExport<T extends Record<string, unknown>>(rows: T[]): T[] {
  const ms = (v: unknown) => {
    const t = asText(v) ? Date.parse(asText(v) as string) : NaN;
    return Number.isNaN(t) ? null : t;
  };
  return [...rows].sort(
    (x, y) =>
      descNullsLast(effectiveCallDate(x), effectiveCallDate(y)) ||
      descNullsLast(ms(x["call_datetime"]), ms(y["call_datetime"])) ||
      descNullsLast(ms(x["created_at"]), ms(y["created_at"])),
  );
}

function csvCell(v: unknown) {
  const raw = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  // Quote alone is insufficient: spreadsheets still evaluate quoted formulas.
  const s = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw) ? "'" + raw : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "id",
  "call_datetime",
  "call_date_only",
  "doctor_id",
  "doctor_name",
  "specialty",
  "clinic",
  "product_names",
  "purpose",
  "feedback",
  "materials_requested",
  "follow_up_action",
  "follow_up_due",
  "original_note",
  "status",
  "created_at",
  "approved_at",
  "edit_count",
] as const;

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[] = CSV_COLUMNS) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
}
