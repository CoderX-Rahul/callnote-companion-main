import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, HelpCircle, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge, fmtDate, fmtDateTime } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { deleteDraft, getMasterData, getReport, saveReport } from "@/lib/reports.functions";
import { combineDateTime, missingRequired, safeDate } from "@/lib/report-rules";
import { unresolvedQuestions } from "@/lib/doctor-search";
import { DoctorSelection } from "@/components/DoctorSelection";
import { ReportIntelligence } from "@/components/ReportIntelligence";
import { readIntelligence } from "@/lib/report-intelligence";
import { ReportEffectiveness } from "@/components/ReportEffectiveness";
import { readEffectiveness } from "@/lib/report-effectiveness";
import { readPob } from "@/lib/pob";
import { ReportPob } from "@/components/ReportPob";

const masterQ = queryOptions({ queryKey: ["master"], queryFn: () => getMasterData(), staleTime: Infinity });
const reportQ = (id: string) => queryOptions({ queryKey: ["report", id], queryFn: () => getReport({ data: { id } }) });

export const Route = createFileRoute("/_authenticated/review/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Review call report — FieldIQ Pharma" },
      { name: "description", content: "Review, edit and approve an AI-drafted doctor-call report." },
      { property: "og:title", content: "Review call report — FieldIQ Pharma" },
      { property: "og:description", content: "Review, edit and approve an AI-drafted doctor-call report." },
    ],
  }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(masterQ),
      context.queryClient.ensureQueryData(reportQ(params.id)),
    ]),
  component: Review,
});

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"] === "24" ? "00" : p["hour"]}:${p["minute"]}`;
}

const inputCls = "w-full rounded-xl border bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring";

function Field({ label, known, required, children }: { label: string; known: boolean; required?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </span>
        {known ? (
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Filled</span>
        ) : (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">Unknown</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Review() {
  const { id } = Route.useParams();
  const { data: master } = useSuspenseQuery(masterQ);
  const { data } = useSuspenseQuery(reportQ(id));
  const r = data.report;
  if (r.status === "approved" || !r.can_edit) return <ReadOnlyReportView data={data} />;
  return <DraftForm key={r.updated_at} data={data} master={master} />;
}

type ReportData = Awaited<ReturnType<typeof getReport>>;
type Master = Awaited<ReturnType<typeof getMasterData>>;

function DraftForm({ data, master }: { data: ReportData; master: Master }) {
  const r = data.report;
  const local = toLocalInput(r.call_datetime);
  const [callDate, setCallDate] = useState(r.call_date_only ?? local.slice(0, 10));
  const [callTime, setCallTime] = useState(local.slice(11, 16));
  const [doctorId, setDoctorId] = useState(r.doctor_id ?? "");
  const [products, setProducts] = useState<string[]>(r.product_ids);
  const [purpose, setPurpose] = useState(r.purpose ?? "");
  const [feedback, setFeedback] = useState(r.feedback ?? "");
  const [materials, setMaterials] = useState(r.materials_requested ?? "");
  const [fuAction, setFuAction] = useState(r.follow_up_action ?? "");
  const [fuDue, setFuDue] = useState(r.follow_up_due ?? "");
  const [intelligence, setIntelligence] = useState(() => readIntelligence(r.intelligence));
  const [effectiveness, setEffectiveness] = useState(() => readEffectiveness(r.effectiveness));
  const [pob, setPob] = useState(() => readPob(Reflect.get(r, "pob")));
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const save = useServerFn(saveReport);
  const del = useServerFn(deleteDraft);
  const qc = useQueryClient();
  const nav = useNavigate();

  const doctorChoices = (r.ai_doctor_choices as string[]) ?? [];
  const productChoices = (r.ai_product_choices as { mention: string; ids: string[] }[]) ?? [];
  const validDate = !!safeDate(callDate);
  const questions = unresolvedQuestions(r.ai_questions, doctorId || null, validDate);
  const fields = {
    call_datetime: combineDateTime(callDate, callTime),
    call_date_only: safeDate(callDate),
    doctor_id: doctorId || null,
    product_ids: products,
    purpose: purpose || null,
    feedback: feedback || null,
    materials_requested: materials || null,
    follow_up_action: fuAction || null,
    follow_up_due: fuDue || null,
  };
  const missing = missingRequired(fields);
  const doctor = master.doctors.find((d) => d.id === doctorId);
  const toggleProduct = (pid: string) => setProducts((p) => (p.includes(pid) ? p.filter((x) => x !== pid) : [...p, pid]));

  async function submit(approve: boolean) {
    setBusy(approve ? "approve" : "save");
    try {
      await save({ data: { id: r.id, fields, approve, intelligence, effectiveness, pob, expectedUpdatedAt: r.updated_at } });
      await qc.invalidateQueries();
      toast.success(approve ? "Report approved" : "Draft saved");
      if (approve) nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between">
        <Link to="/" className="flex h-11 items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <StatusBadge status="draft" />
      </div>
      <h1 className="mb-3 text-2xl font-semibold">Review draft</h1>

      {questions.length > 0 && (
        <div className="mb-3 rounded-2xl border border-warning/30 bg-warning-soft p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-warning">
            <HelpCircle className="h-5 w-5" /> Please confirm
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <Field label="Doctor" known={!!doctorId} required>
          {r.original_doctor_mention && <p className="mb-2 text-sm text-muted-foreground">Original mention: “{r.original_doctor_mention}”</p>}
          <DoctorSelection doctors={master.doctors} value={doctorId} onChange={setDoctorId} suggestedIds={doctorChoices} />
          {doctor && (
            <p className="mt-2 text-sm text-muted-foreground">
              {doctor.specialty ?? "Specialty unknown"} · {doctor.clinic ?? "Clinic unknown"} · {doctor.city}
            </p>
          )}
        </Field>

        <Field label="Call date" known={validDate} required>
          <input aria-label="Call date" type="date" className={inputCls} value={callDate} onChange={(e) => setCallDate(e.target.value)} />
        </Field>
        <Field label="Call time (optional)" known={!!callTime}>
          <input aria-label="Call time" type="time" className={inputCls} value={callTime} onChange={(e) => setCallTime(e.target.value)} />
          {!callTime && <p className="mt-2 text-sm text-muted-foreground">Time unknown</p>}
        </Field>

        <Field label="Products discussed" known={products.length > 0} required>
          {productChoices.filter((g) => !g.ids.some((i) => products.includes(i))).map((g) => (
            <p key={g.mention} className="mb-2 text-sm text-warning">“{g.mention}” matches several products — tap the right one.</p>
          ))}
          <div className="flex flex-wrap gap-2">
            {master.products.map((p) => {
              const on = products.includes(p.id);
              const suggested = productChoices.some((g) => g.ids.includes(p.id));
              return (
                <button
                  key={p.id}
                  onClick={() => toggleProduct(p.id)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-medium ${on ? "border-primary bg-primary text-primary-foreground" : suggested ? "border-warning bg-warning-soft" : "bg-card"}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Purpose of visit" known={!!purpose.trim()} required>
          <input className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Not stated in note" />
        </Field>
        <Field label="Doctor feedback & questions" known={!!feedback.trim()}>
          <textarea rows={3} className={inputCls} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Not stated in note" />
        </Field>
        <Field label="Materials / information requested" known={!!materials.trim()}>
          <input className={inputCls} value={materials} onChange={(e) => setMaterials(e.target.value)} placeholder="Not stated in note" />
        </Field>
        <Field label="Follow-up" known={!!fuAction.trim()}>
          <input className={inputCls} value={fuAction} onChange={(e) => setFuAction(e.target.value)} placeholder="Action (not stated)" />
          <label className="mt-2 block text-xs text-muted-foreground">
            Due date
            <input type="date" className={inputCls} value={fuDue} onChange={(e) => setFuDue(e.target.value)} />
          </label>
        </Field>

        <ReportIntelligence value={intelligence} onChange={setIntelligence} products={master.products} />
        <ReportEffectiveness value={effectiveness} onChange={setEffectiveness} products={master.products} />
        <ReportPob value={pob} onChange={setPob} products={master.products} schemes={master.schemes} originalNote={r.original_note} callDate={safeDate(callDate)} />
        {readPob(Reflect.get(r, "ai_pob")).lines.length > 0 && <details className="border-b py-3"><summary className="cursor-pointer text-sm font-semibold">Original POB extraction</summary><ReportPob value={readPob(Reflect.get(r, "ai_pob"))} products={master.products} schemes={master.schemes} originalNote={r.original_note} callDate={r.call_date_only} /></details>}
        {r.ai_intelligence && <details className="border-y py-3"><summary className="cursor-pointer text-sm font-semibold">Original intelligence extraction</summary><ReportIntelligence value={readIntelligence(r.ai_intelligence)} /></details>}
        {r.ai_effectiveness && <details className="border-b py-3"><summary className="cursor-pointer text-sm font-semibold">Original effectiveness extraction</summary><ReportEffectiveness value={readEffectiveness(r.ai_effectiveness)} /></details>}
        <details className="rounded-2xl bg-muted p-4">
          <summary className="cursor-pointer text-sm font-semibold">Original note (kept for audit)</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm">{r.original_note}</p>
          {r.normalized_note && r.normalized_note !== r.original_note && <div className="mt-3"><p className="text-xs font-semibold">Normalized note · glossary {r.glossary_version}</p><p className="mt-1 whitespace-pre-wrap text-sm">{r.normalized_note}</p></div>}
          <p className="mt-2 text-xs text-muted-foreground">Created {fmtDateTime(r.created_at)} · {r.edit_count} edits</p>
        </details>
        <button
          onClick={async () => {
            if (!confirm("Delete this draft?")) return;
            await del({ data: { id: r.id } });
            await qc.invalidateQueries();
            nav({ to: "/" });
          }}
          className="flex h-11 w-full items-center justify-center gap-2 text-sm text-destructive"
        >
          <Trash2 className="h-4 w-4" /> Delete draft
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          {missing.length > 0 && <p className="mb-2 text-center text-xs text-warning">Needed to approve: {missing.join(", ")}</p>}
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Button variant="outline" className="h-14 rounded-2xl text-base" disabled={!!busy} onClick={() => submit(false)}>
              {busy === "save" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} Save
            </Button>
            <Button className="h-14 rounded-2xl text-base" disabled={!!busy || missing.length > 0} onClick={() => submit(true)}>
              {busy === "approve" ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Approve report
            </Button>
          </div>
        </div>
      </div>
      <div className="h-32" />
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b py-3 last:border-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base">{value || <span className="italic text-muted-foreground">Unknown — not in note</span>}</div>
    </div>
  );
}

function ReadOnlyReportView({ data }: { data: ReportData }) {
  const r = data.report;
  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between">
        <Link to="/history" className="flex h-11 items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> History
        </Link>
        <StatusBadge status={r.status} />
      </div>
      <h1 className="mb-3 text-2xl font-semibold">{r.doctor_name}</h1>
      {!r.can_edit && <p className="mb-3 text-sm text-muted-foreground">Rep: {r.rep_name}</p>}
      <div className="rounded-2xl bg-card px-4 shadow-card">
        <Row label="Doctor ID" value={r.doctor_id} />
        <Row label="Specialty · Clinic" value={[r.specialty, r.clinic].filter(Boolean).join(" · ")} />
        <Row label="Call date & time" value={fmtDateTime(r.call_datetime) ?? (r.call_date_only ? `${fmtDate(r.call_date_only)} · time unknown` : null)} />
        <Row label="Products discussed" value={r.product_names.join(", ")} />
        <Row label="Purpose" value={r.purpose} />
        <Row label="Feedback & questions" value={r.feedback} />
        <Row label="Materials requested" value={r.materials_requested} />
        <Row label="Follow-up" value={r.follow_up_action && `${r.follow_up_action}${r.follow_up_due ? ` — due ${fmtDate(r.follow_up_due)}` : ""}${r.follow_up_done ? " ✓ done" : ""}`} />
      </div>
      <ReportIntelligence value={readIntelligence(r.intelligence)} />
      <ReportEffectiveness value={readEffectiveness(r.effectiveness)} products={[]} />
      <ReportPob value={readPob(Reflect.get(r, "pob"))} products={[]} schemes={[]} originalNote={r.original_note} callDate={r.call_date_only} />
      {readPob(Reflect.get(r, "ai_pob")).lines.length > 0 && <details className="border-b py-3"><summary className="cursor-pointer text-sm font-semibold">Original POB extraction</summary><ReportPob value={readPob(Reflect.get(r, "ai_pob"))} products={[]} schemes={[]} originalNote={r.original_note} callDate={r.call_date_only} /></details>}
      {r.ai_intelligence && <details className="border-y py-3"><summary className="cursor-pointer text-sm font-semibold">Original intelligence extraction</summary><ReportIntelligence value={readIntelligence(r.ai_intelligence)} /></details>}
      <div className="mt-3 rounded-2xl bg-muted p-4">
        <div className="text-sm font-semibold">Original note</div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{r.original_note}</p>
        {r.normalized_note && r.normalized_note !== r.original_note && <div className="mt-3"><p className="text-xs font-semibold">Normalized note · glossary {r.glossary_version}</p><p className="mt-1 whitespace-pre-wrap text-sm">{r.normalized_note}</p></div>}
      </div>
      <div className="mt-3 rounded-2xl bg-card p-4 text-sm shadow-card">
        <div className="font-semibold">Audit trail</div>
        <p className="mt-1 text-muted-foreground">Created {fmtDateTime(r.created_at)}</p>
        {r.approved_at && <p className="text-muted-foreground">Approved {fmtDateTime(r.approved_at)}</p>}
        <p className="text-muted-foreground">{r.edit_count} field edits</p>
        {data.edits.length > 0 && (
          <ul className="mt-2 space-y-1">
            {data.edits.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="font-medium">{e.field}</span>: “{e.old_value ?? "—"}” → “{e.new_value ?? "—"}”{" "}
                <span className="text-muted-foreground">({fmtDateTime(e.edited_at)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
