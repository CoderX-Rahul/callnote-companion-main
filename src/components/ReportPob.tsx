import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computePobLine,
  normalizePob,
  type PobDocument,
  type PobLine,
  type ProductForPob,
  type ProductScheme,
} from "@/lib/pob";

const control = "mt-1 min-h-11 w-full rounded-lg border bg-card px-3 py-2 text-base";
const money = (value: number | null) =>
  value == null
    ? "Unknown"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

type Props = {
  value: PobDocument;
  products: ProductForPob[];
  schemes: ProductScheme[];
  originalNote: string;
  callDate: string | null;
  onChange?: (value: PobDocument) => void;
};

export function ReportPob({ value, products, schemes, originalNote, callDate, onChange }: Props) {
  const update = (index: number, patch: Partial<PobLine>) => {
    if (!onChange) return;
    const lines = value.lines.map((line, i) => (i === index ? { ...line, ...patch } : line));
    onChange(normalizePob({ lines }, originalNote, callDate, products, schemes));
  };
  const validSchemes = (productId: string | null) =>
    schemes.filter(
      (scheme) =>
        scheme.product_id === productId &&
        scheme.active &&
        !!callDate &&
        (!scheme.valid_from || scheme.valid_from <= callDate) &&
        (!scheme.valid_to || scheme.valid_to >= callDate),
    );

  return (
    <section className="space-y-4 py-4" aria-label="Orders (POB)">
      <div>
        <h2 className="text-lg font-semibold">
          Orders (POB){" "}
          <span className="text-xs font-normal text-muted-foreground">Optional · at MRP</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Record only order discussions explicitly stated in the note. POB never blocks approval.
        </p>
      </div>
      {!value.lines.length && (
        <p className="text-sm text-muted-foreground">No order lines recorded</p>
      )}
      {value.lines.map((line, index) => {
        const choices = validSchemes(line.product_id);
        const preview = computePobLine({
          quantity: line.quantity,
          unitMrp: line.unit_mrp_snapshot,
          discountPct: line.discount_pct_snapshot,
        });
        return (
          <article key={index} className="space-y-3 rounded-xl border bg-card p-4">
            <header className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{line.product_mention || `Order ${index + 1}`}</h3>
              {onChange && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove order ${index + 1}`}
                  onClick={() => onChange({ lines: value.lines.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </header>
            {onChange ? (
              <>
                <label className="block text-sm">
                  Product
                  <select
                    className={control}
                    aria-label={`POB product ${index + 1}`}
                    value={line.product_id ?? ""}
                    onChange={(event) =>
                      update(index, {
                        product_id: event.target.value || null,
                        candidate_ids: event.target.value ? [event.target.value] : [],
                      })
                    }
                  >
                    <option value="">Unknown product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · MRP{" "}
                        {money(product.mrp == null ? null : Number(product.mrp))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Quantity
                  <input
                    className={control}
                    aria-label={`POB quantity ${index + 1}`}
                    type="number"
                    min={0}
                    step={1}
                    value={line.quantity ?? ""}
                    placeholder="Unknown"
                    onChange={(event) => {
                      const value = event.target.value === "" ? null : Number(event.target.value);
                      update(index, {
                        quantity:
                          value !== null && Number.isInteger(value) && value >= 0 ? value : null,
                      });
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Order status
                  <select
                    className={control}
                    aria-label={`POB status ${index + 1}`}
                    value={line.status}
                    onChange={(event) =>
                      update(index, { status: event.target.value as PobLine["status"] })
                    }
                  >
                    {["Booked", "Tentative", "Unknown"].map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Scheme
                  <select
                    disabled={!callDate}
                    className={control}
                    aria-label={`POB scheme ${index + 1}`}
                    value={line.scheme_id ?? ""}
                    onChange={(event) => {
                      const scheme = choices.find((item) => item.id === event.target.value);
                      const mention =
                        scheme?.scheme_type === "free_goods"
                          ? `${scheme.buy_qty}+${scheme.free_qty}`
                          : scheme?.scheme_type === "discount_percent"
                            ? `${scheme.discount_pct}%`
                            : null;
                      update(index, { scheme_id: scheme?.id ?? null, scheme_mention: mention });
                    }}
                  >
                    <option value="">No scheme / unstated</option>
                    {choices.map((scheme) => (
                      <option key={scheme.id} value={scheme.id}>
                        {scheme.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    Free units{" "}
                    <div className="font-semibold">{line.free_quantity ?? "Unknown"}</div>
                  </div>
                  <div>
                    Line value at MRP{" "}
                    <div className="font-semibold">{money(preview.lineValue)}</div>
                  </div>
                </div>
                <label className="block text-sm">
                  Evidence from original note
                  <textarea
                    className={control}
                    aria-label={`POB evidence ${index + 1}`}
                    rows={2}
                    maxLength={2000}
                    value={line.evidence ?? ""}
                    onChange={(event) => update(index, { evidence: event.target.value || null })}
                  />
                </label>
                {line.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-warning">
                    {warning}
                  </p>
                ))}
              </>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  Product:{" "}
                  {products.find((p) => p.id === line.product_id)?.name ?? line.product_mention}
                </div>
                <div>
                  Quantity: {line.quantity ?? "Unknown"} · Status: {line.status}
                </div>
                <div>
                  Scheme: {line.scheme_mention ?? "None stated"} · Free units:{" "}
                  {line.free_quantity ?? "Unknown"}
                </div>
                <div>Value at MRP: {money(line.line_value)}</div>
                <div>Evidence: {line.evidence ?? "Unknown"}</div>
                {line.warnings.map((warning) => (
                  <div className="text-warning" key={warning}>
                    {warning}
                  </div>
                ))}
              </dl>
            )}
          </article>
        );
      })}
      {onChange && (
        <Button
          variant="outline"
          disabled={value.lines.length >= 30}
          onClick={() =>
            onChange(
              normalizePob(
                {
                  lines: [
                    ...value.lines,
                    {
                      product_mention: "",
                      mention: "",
                      candidate_ids: [],
                      product_id: null,
                      quantity: null,
                      scheme_mention: null,
                      scheme_id: null,
                      status: "Unknown",
                      free_quantity: 0,
                      unit_mrp_snapshot: null,
                      discount_pct_snapshot: null,
                      line_value: null,
                      stated_unit_price: null,
                      evidence: null,
                      warnings: [],
                    },
                  ],
                },
                originalNote,
                callDate,
                products,
                schemes,
              ),
            )
          }
        >
          <Plus className="h-4 w-4" />
          Add order line
        </Button>
      )}
    </section>
  );
}
