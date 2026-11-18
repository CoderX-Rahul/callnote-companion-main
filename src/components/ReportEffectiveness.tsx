import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACCESS_QUALITIES, COLLATERAL_TYPES, COMMITMENT_STATUSES, HCP_TIERS, SAMPLE_DISTRIBUTION_STATUSES,
  type Effectiveness,
} from "@/lib/report-effectiveness";

const control = "mt-1 w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-base";
type Props = { value: Effectiveness; onChange?: (value: Effectiveness) => void; products?: { id: string; name: string }[] };

function TextField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <label className="block text-sm">{label}<textarea rows={2} className={control} aria-label={label} value={value ?? ""} maxLength={5000} onChange={(e) => onChange(e.target.value || null)} /></label>;
}
function Options({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="block text-sm">{label}<select className={control} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((s) => <option key={s}>{s}</option>)}</select></label>;
}
function Quantity({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label className="block text-sm">{label}<input type="number" min={0} step={1} className={control} aria-label={label} value={value ?? ""} placeholder="Unknown" onChange={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); onChange(n !== null && Number.isInteger(n) && n >= 0 ? n : null); }} /></label>;
}

export function ReportEffectiveness({ value, onChange, products = [] }: Props) {
  const updateSample = (i: number, patch: Partial<Effectiveness["samples"][number]>) => onChange?.({ ...value, samples: value.samples.map((s, n) => n === i ? { ...s, ...patch } : s) });
  const updateCommitment = (i: number, patch: Partial<Effectiveness["commitments"][number]>) => onChange?.({ ...value, commitments: value.commitments.map((c, n) => n === i ? { ...c, ...patch } : c) });
  const toggleCollateral = (type: string) => {
    if (!onChange) return;
    const exists = value.collateral.some((c) => c.material_type === type);
    onChange({ ...value, collateral: exists ? value.collateral.filter((c) => c.material_type !== type) : [...value.collateral, { material_type: type as Effectiveness["collateral"][number]["material_type"], detail: null }] });
  };
  return <section className="space-y-4 py-4" aria-label="Field effectiveness">
    <h2 className="text-lg font-semibold">Samples <span className="text-xs font-normal text-muted-foreground">Optional</span></h2>
    {!value.samples.length && <p className="text-sm text-muted-foreground">No samples recorded</p>}
    {value.samples.map((s, i) => <article className="space-y-3 rounded-lg border bg-card p-4" key={i}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{s.product_mention || `Sample ${i + 1}`}</h3>{onChange && <Button variant="ghost" size="icon" aria-label={`Remove sample ${i + 1}`} onClick={() => onChange({ ...value, samples: value.samples.filter((_, n) => n !== i) })}><Trash2 className="h-4 w-4" /></Button>}</div>
      {onChange ? <>
        <TextField label="Sample product mention" value={s.product_mention} onChange={(v) => updateSample(i, { product_mention: v ?? "" })} />
        <label className="block text-sm">Master product match<select aria-label="Sample master product" className={control} value={s.product_id ?? ""} onChange={(e) => updateSample(i, { product_id: e.target.value || null })}><option value="">Unknown</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <Quantity label="Sample quantity" value={s.quantity} onChange={(v) => updateSample(i, { quantity: v })} />
        <Options label="Distribution status" value={s.distribution_status} options={SAMPLE_DISTRIBUTION_STATUSES} onChange={(v) => updateSample(i, { distribution_status: v as typeof s.distribution_status })} />
        <TextField label="Sample evidence" value={s.evidence} onChange={(v) => updateSample(i, { evidence: v })} />
      </> : <dl className="space-y-2 text-sm"><div>Product: {products.find((p) => p.id === s.product_id)?.name ?? s.product_mention}</div><div>Quantity: {s.quantity ?? "Unknown"} · {s.distribution_status}</div><div>Evidence: {s.evidence ?? "Unknown"}</div></dl>}
    </article>)}
    {onChange && <Button variant="outline" disabled={value.samples.length >= 20} onClick={() => onChange({ ...value, samples: [...value.samples, { product_mention: "", candidate_ids: [], quantity: null, distribution_status: "Unknown", evidence: null, product_id: null }] })}><Plus className="h-4 w-4" />Add sample</Button>}

    <h2 className="pt-2 text-lg font-semibold">Collateral <span className="text-xs font-normal text-muted-foreground">Optional</span></h2>
    {onChange ? <div className="grid gap-2">{COLLATERAL_TYPES.map((type) => {
      const item = value.collateral.find((c) => c.material_type === type);
      return <div key={type} className="rounded-lg border bg-card p-3">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!item} onChange={() => toggleCollateral(type)} />{type}</label>
        {item && <TextField label={`${type} detail`} value={item.detail} onChange={(v) => onChange({ ...value, collateral: value.collateral.map((c) => c.material_type === type ? { ...c, detail: v } : c) })} />}
      </div>;
    })}</div> : !value.collateral.length ? <p className="text-sm text-muted-foreground">No collateral recorded</p> :
      <ul className="space-y-2 text-sm">{value.collateral.map((c, i) => <li key={i}>{c.material_type}{c.detail ? ` · ${c.detail}` : ""}</li>)}</ul>}

    <h2 className="pt-2 text-lg font-semibold">Conversion commitments <span className="text-xs font-normal text-muted-foreground">Optional · a commitment is not a prescription</span></h2>
    {!value.commitments.length && <p className="text-sm text-muted-foreground">No commitment recorded</p>}
    {value.commitments.map((c, i) => <article className="space-y-3 rounded-lg border bg-card p-4" key={i}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Commitment {i + 1}</h3>{onChange && <Button variant="ghost" size="icon" aria-label={`Remove commitment ${i + 1}`} onClick={() => onChange({ ...value, commitments: value.commitments.filter((_, n) => n !== i) })}><Trash2 className="h-4 w-4" /></Button>}</div>
      {onChange ? <>
        <Options label="Commitment status" value={c.status} options={COMMITMENT_STATUSES} onChange={(v) => updateCommitment(i, { status: v as typeof c.status })} />
        <label className="block text-sm">Commitment date<input type="date" className={control} aria-label="Commitment date" value={c.commitment_date ?? ""} onChange={(e) => updateCommitment(i, { commitment_date: e.target.value || null })} /></label>
        <Quantity label="Trial patient count" value={c.trial_patient_count} onChange={(v) => updateCommitment(i, { trial_patient_count: v })} />
        <TextField label="Follow-up outcome" value={c.follow_up_outcome} onChange={(v) => updateCommitment(i, { follow_up_outcome: v })} />
        <TextField label="Commitment evidence" value={c.evidence} onChange={(v) => updateCommitment(i, { evidence: v })} />
      </> : <dl className="space-y-2 text-sm"><div>Status: {c.status}</div><div>Date: {c.commitment_date ?? "Unknown"} · Trial patients: {c.trial_patient_count ?? "Unknown"}</div><div>Outcome: {c.follow_up_outcome ?? "Unknown"}</div><div>Evidence: {c.evidence ?? "Unknown"}</div></dl>}
    </article>)}
    {onChange && <Button variant="outline" disabled={value.commitments.length >= 10} onClick={() => onChange({ ...value, commitments: [...value.commitments, { commitment_date: null, trial_patient_count: null, status: "Unknown", follow_up_outcome: null, evidence: null }] })}><Plus className="h-4 w-4" />Add commitment</Button>}

    <h2 className="pt-2 text-lg font-semibold">HCP tier and access quality <span className="text-xs font-normal text-muted-foreground">Optional · kept separate</span></h2>
    {onChange ? <>
      <label className="block text-sm">HCP tier<select aria-label="HCP tier" className={control} value={value.hcp_tier ?? ""} onChange={(e) => onChange({ ...value, hcp_tier: (e.target.value || null) as Effectiveness["hcp_tier"] })}><option value="">Unclassified / not stated</option>{HCP_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <Options label="Access quality" value={value.access_quality} options={ACCESS_QUALITIES} onChange={(v) => onChange({ ...value, access_quality: v as Effectiveness["access_quality"] })} />
    </> : <dl className="space-y-2 text-sm"><div>HCP tier: {value.hcp_tier ?? "Unclassified"}</div><div>Access quality: {value.access_quality}</div></dl>}
  </section>;
}
