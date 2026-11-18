import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BARRIER_CATEGORIES, BARRIER_STATUSES, PREFERENCE_REASONS, SENTIMENTS, type Intelligence } from "@/lib/report-intelligence";

const control = "mt-1 w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-base";
type Props = { value: Intelligence; onChange?: (value: Intelligence) => void; products?: { id: string; name: string }[] };

function TextField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <label className="block text-sm">{label}<textarea rows={2} className={control} aria-label={label} value={value ?? ""} maxLength={5000} onChange={(e) => onChange(e.target.value || null)} /></label>;
}
function Options({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="block text-sm">{label}<select className={control} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((s) => <option key={s}>{s}</option>)}</select></label>;
}

export function ReportIntelligence({ value, onChange, products = [] }: Props) {
  const updateCompetitor = (i: number, patch: Partial<Intelligence["competitors"][number]>) => onChange?.({ ...value, competitors: value.competitors.map((c, n) => n === i ? { ...c, ...patch } : c) });
  const updateBarrier = (i: number, patch: Partial<Intelligence["barriers"][number]>) => onChange?.({ ...value, barriers: value.barriers.map((b, n) => n === i ? { ...b, ...patch } : patch.primary ? { ...b, primary: false } : b) });
  return <section className="space-y-4 py-4" aria-label="Competitor and prescribing intelligence">
    <h2 className="text-lg font-semibold">Competitor intelligence <span className="text-xs font-normal text-muted-foreground">Optional</span></h2>
    {!value.competitors.length && <p className="text-sm text-muted-foreground">No competitor recorded</p>}
    {value.competitors.map((c, i) => <article className="space-y-3 rounded-lg border bg-card p-4" key={i}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{c.original_mention || `Competitor ${i + 1}`}</h3>{onChange && <Button variant="ghost" size="icon" aria-label={`Remove competitor ${i + 1}`} onClick={() => onChange({ ...value, competitors: value.competitors.filter((_, n) => n !== i) })}><Trash2 className="h-4 w-4" /></Button>}</div>
      {c.ambiguous && !c.identity_confirmed && <p className="text-sm text-warning">Identity uncertain · confirmation needed for a named match</p>}
      {onChange ? <>
        <TextField label="Original competitor mention" value={c.original_mention} onChange={(v) => updateCompetitor(i, { original_mention: v ?? "" })} />
        <TextField label="Competitor brand discussed" value={c.brand_discussed} onChange={(v) => updateCompetitor(i, { brand_discussed: v, identity_confirmed: false, product_id: null })} />
        <label className="block text-sm">Master product match<select aria-label="Master product match" className={control} value={c.product_id ?? ""} onChange={(e) => updateCompetitor(i, { product_id: e.target.value || null, identity_confirmed: !!e.target.value, brand_discussed: products.find((p) => p.id === e.target.value)?.name ?? c.brand_discussed })}><option value="">Unknown / external brand</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={c.identity_confirmed} onChange={(e) => updateCompetitor(i, { identity_confirmed: e.target.checked, product_id: e.target.checked ? c.product_id : null })} />Identity manually confirmed</label>
        <Options label="Competitor sentiment" value={c.sentiment} options={SENTIMENTS} onChange={(v) => updateCompetitor(i, { sentiment: v as typeof c.sentiment })} />
        <Options label="Reason for preference" value={c.reason_for_preference} options={PREFERENCE_REASONS} onChange={(v) => updateCompetitor(i, { reason_for_preference: v as typeof c.reason_for_preference })} />
        <TextField label="Preference detail" value={c.preference_detail} onChange={(v) => updateCompetitor(i, { preference_detail: v })} />
        <TextField label="Competitor evidence" value={c.evidence} onChange={(v) => updateCompetitor(i, { evidence: v })} />
      </> : <dl className="space-y-2 text-sm"><div>Brand: {c.brand_discussed ?? "Unknown"} · {c.identity_confirmed ? "Confirmed" : "Identity unconfirmed"}</div><div>Sentiment: {c.sentiment}</div><div>Preference: {c.reason_for_preference}{c.preference_detail ? ` · ${c.preference_detail}` : ""}</div><div>Evidence: {c.evidence ?? "Unknown"}</div></dl>}
    </article>)}
    {onChange && <Button variant="outline" disabled={value.competitors.length >= 20} onClick={() => onChange({ ...value, competitors: [...value.competitors, { original_mention: "", brand_discussed: null, candidate_ids: [], ambiguous: false, sentiment: "Unknown", reason_for_preference: "Unknown", preference_detail: null, evidence: null, product_id: null, identity_confirmed: false }] })}><Plus className="h-4 w-4" />Add competitor</Button>}
    <h2 className="pt-2 text-lg font-semibold">Prescribing barriers <span className="text-xs font-normal text-muted-foreground">Optional</span></h2>
    {!value.barriers.length && <p className="text-sm text-muted-foreground">No barrier recorded</p>}
    {value.barriers.map((b, i) => <article className="space-y-3 rounded-lg border bg-card p-4" key={i}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{b.primary ? "Primary barrier" : `Barrier ${i + 1}`}</h3>{onChange && <Button variant="ghost" size="icon" aria-label={`Remove barrier ${i + 1}`} onClick={() => onChange({ ...value, barriers: value.barriers.filter((_, n) => n !== i) })}><Trash2 className="h-4 w-4" /></Button>}</div>
      {onChange ? <>
        <Options label="Conversion barrier" value={b.category} options={BARRIER_CATEGORIES} onChange={(v) => updateBarrier(i, { category: v as typeof b.category })} />
        <Options label="Barrier status" value={b.status} options={BARRIER_STATUSES} onChange={(v) => updateBarrier(i, { status: v as typeof b.status })} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={b.primary} onChange={(e) => updateBarrier(i, { primary: e.target.checked })} />Primary conversion barrier</label>
        <TextField label="Barrier evidence" value={b.evidence} onChange={(v) => updateBarrier(i, { evidence: v })} />
        <TextField label="Suggested follow-up action" value={b.suggested_followup_action} onChange={(v) => updateBarrier(i, { suggested_followup_action: v })} />
      </> : <div className="space-y-2 text-sm"><p>{b.category} · {b.status}</p><p>Evidence: {b.evidence ?? "Unknown"}</p><p>Suggested follow-up: {b.suggested_followup_action ?? "Unknown"}</p></div>}
    </article>)}
    {onChange && <Button variant="outline" disabled={value.barriers.length >= 20} onClick={() => onChange({ ...value, barriers: [...value.barriers, { category: "Unknown", status: "Unknown", primary: false, evidence: null, suggested_followup_action: null }] })}><Plus className="h-4 w-4" />Add barrier</Button>}
  </section>;
}