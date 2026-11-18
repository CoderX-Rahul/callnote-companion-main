import type { PobTotals, ProductForPob, ProductScheme } from "./pob";
import type { HierarchyRow } from "./pob";

type Result<T> = { data: T | null; error: { message?: string } | null };
interface PobQuery<T> extends PromiseLike<Result<T>> {
  select(columns: string): PobQuery<T>;
  order(column: string): PobQuery<T>;
  eq(column: string, value: string): PobQuery<T>;
  in(column: string, values: string[]): PobQuery<T>;
}
type PobDb = {
  from(table: "products"): PobQuery<(ProductForPob & { category: string | null })[]>;
  from(table: "product_schemes"): PobQuery<ProductScheme[]>;
  from(table: "mr_profiles"): PobQuery<HierarchyRow[]>;
  rpc(
    name: "pob_monthly_totals",
    args: Record<string, unknown>,
  ): PromiseLike<
    Result<
      {
        mr_profile_id: string;
        approved_calls: number;
        booked_calls: number;
        booked_lines: number;
        booked_value: number | string | null;
      }[]
    >
  >;
};
interface PobReportUpdate extends PromiseLike<Result<{ id: string }>> {
  update(values: Record<string, unknown>): PobReportUpdate;
  eq(column: string, value: string): PobReportUpdate;
  in(column: string, values: string[]): PobReportUpdate;
  is(column: string, value: null): PobReportUpdate;
  select(columns: string): PobReportUpdate;
  single(): PromiseLike<Result<{ id: string }>>;
}

/** Isolates all generated Supabase type gaps introduced by the Part B schema/RPC. */
function pobDb(client: unknown): PobDb {
  return client as PobDb;
}

export function pobReportUpdate(query: unknown, values: Record<string, unknown>): PobReportUpdate {
  return (query as { update(values: Record<string, unknown>): PobReportUpdate }).update(values);
}

export async function loadPobCatalog(client: unknown) {
  const extended = pobDb(client);
  const [products, schemes] = await Promise.all([
    extended.from("products").select("id,name,category,mrp").order("name"),
    extended
      .from("product_schemes")
      .select(
        "id,product_id,label,scheme_type,buy_qty,free_qty,discount_pct,active,valid_from,valid_to",
      )
      .order("label"),
  ]);
  if (products.error) throw products.error;
  if (schemes.error) throw schemes.error;
  return { products: products.data ?? [], schemes: schemes.data ?? [] };
}

export async function loadPobHierarchy(
  client: unknown,
  organizationId: string,
  profileIds?: string[],
) {
  let query = pobDb(client)
    .from("mr_profiles")
    .select("id,reports_to,role,full_name,employee_code")
    .eq("organization_id", organizationId);
  if (profileIds) query = query.in("id", profileIds);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchPobTotals(
  client: unknown,
  organizationId: string,
  profileIds: string[],
  from: string,
  to: string,
) {
  const { data, error } = await pobDb(client).rpc("pob_monthly_totals", {
    p_organization_id: organizationId,
    p_profile_ids: profileIds,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  const result = new Map<string, PobTotals>();
  for (const row of data ?? [])
    result.set(row.mr_profile_id, {
      approved_calls: Number(row.approved_calls),
      booked_calls: Number(row.booked_calls),
      booked_lines: Number(row.booked_lines),
      booked_value: row.booked_value == null ? null : Number(row.booked_value),
    });
  return result;
}
