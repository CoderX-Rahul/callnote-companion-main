import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, ClipboardCheck, CalendarClock, Layers, Plus, ChevronRight } from "lucide-react";
import { AppShell, fmtDateTime } from "@/components/AppShell";
import { getDashboard, getPobSummary } from "@/lib/reports.functions";

const dashQ = queryOptions({ queryKey: ["dashboard"], queryFn: () => getDashboard() });

function roleLabel(role: string) {
  switch (role) {
    case "mr": return "Medical Representative";
    case "asm": return "Area Sales Manager";
    case "rsm": return "Regional Sales Manager";
    case "zsm": return "Zonal Sales Manager";
    case "nsm": return "National Sales Manager";
    case "admin": return "Administrator";
    case "manager": return "Manager";
    default: return "Medical Representative";
  }
}

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "FieldIQ Pharma — Dashboard" },
      { name: "description", content: "AI-assisted doctor-call reporting for medical representatives." },
      { property: "og:title", content: "FieldIQ Pharma — Dashboard" },
      { property: "og:description", content: "Turn post-visit notes into structured doctor-call reports." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashQ),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useSuspenseQuery(dashQ);
  const initialMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date());
  const [pobMonth, setPobMonth] = useState(initialMonth);
  const pobQuery = queryOptions({ queryKey: ["pob-summary", pobMonth], queryFn: () => getPobSummary({ data: { month: pobMonth } }) });
  const { data: pob } = useSuspenseQuery(pobQuery);
  const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date());
  const currency = (amount: number | null) => amount === null ? "Incomplete data" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
  const conversion = pob.total.approved_calls ? `${(100 * pob.total.booked_calls / pob.total.approved_calls).toFixed(1)}%` : "—";
  const average = pob.total.booked_calls && pob.total.booked_value !== null ? pob.total.booked_value / pob.total.booked_calls : null;
  const stats = [
    { label: "Total calls", value: data.total, icon: Layers, to: "/history" as const },
    { label: "Draft reports", value: data.drafts, icon: FileText, to: "/history" as const },
    { label: "Approved", value: data.approved, icon: ClipboardCheck, to: "/history" as const },
    { label: "Follow-ups (7 days)", value: data.followUpsDue, icon: CalendarClock, to: "/followups" as const },
  ];
  return (
    <AppShell>
      <div className="mb-5 rounded-3xl bg-hero p-5 text-primary-foreground shadow-card">
        <p className="text-sm opacity-80">Good day, {data.profile.full_name}</p>
        <h1 className="mt-1 text-2xl font-semibold">FieldIQ Pharma</h1>
        <p className="mt-1 text-sm opacity-80">
          {[
            data.profile.employee_code,
            data.profile.division,
            [data.profile.territory, data.profile.headquarters].filter(Boolean).join(" · "),
          ]
            .filter(Boolean)
            .join(" · ") || "MR workspace"}
        </p>
        <p className="mt-1 text-xs opacity-60">Demo organization — doctor and product lists are sample data</p>
        <p className="mt-1 text-xs opacity-80">{roleLabel(data.profile.role)} Â· {data.profile.scopeLabel}</p>
        <Link
          to="/new"
          className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-card text-base font-semibold text-primary"
        >
          <Plus className="h-5 w-5" /> Report a new call
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-2xl bg-card p-4 shadow-card">
            <s.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-3xl font-semibold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </Link>
        ))}
      </div>
      <section className="mt-6 rounded-2xl bg-card p-4 shadow-card" aria-label="POB this month at MRP">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">POB this month (at MRP)</h2>
          <label className="text-sm">Month <input aria-label="POB month" className="ml-2 min-h-11 rounded-lg border bg-background px-3" type="month" value={pobMonth} max={currentMonth} onChange={(event) => { if (event.target.value) setPobMonth(event.target.value); }} /></label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted p-3"><div className="text-xs text-muted-foreground">Booked value</div><div className="mt-1 font-display text-xl font-semibold">{currency(pob.total.booked_value)}</div></div>
          <div className="rounded-xl bg-muted p-3"><div className="text-xs text-muted-foreground">Booked calls</div><div className="mt-1 font-display text-xl font-semibold">{pob.total.booked_calls}</div></div>
          <div className="rounded-xl bg-muted p-3"><div className="text-xs text-muted-foreground">Order conversion</div><div className="mt-1 font-display text-xl font-semibold">{conversion}</div><div className="text-xs text-muted-foreground">{pob.total.booked_calls} booked / {pob.total.approved_calls} approved calls</div></div>
          <div className="rounded-xl bg-muted p-3"><div className="text-xs text-muted-foreground">Average POB per booked call</div><div className="mt-1 font-display text-xl font-semibold">{pob.total.booked_calls ? currency(average) : "—"}</div></div>
        </div>
        {pob.breakdown.length > 0 && data.profile.role !== "mr" && <div className="mt-4 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold">Direct-report roll-up</h3><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-2">Team</th><th className="py-2 pr-2">Approved</th><th className="py-2 pr-2">Booked</th><th className="py-2">Value at MRP</th></tr></thead><tbody>{pob.breakdown.map((row) => <tr key={row.profile_id ?? row.label} className="border-b last:border-0"><td className="py-2 pr-2">{row.label}</td><td className="py-2 pr-2">{row.approved_calls}</td><td className="py-2 pr-2">{row.booked_calls}</td><td className="py-2">{currency(row.booked_value)}</td></tr>)}</tbody></table></div>}
        <p className="mt-3 text-xs text-muted-foreground">Booked value uses product MRP after a matched master discount. Conversion = approved calls with at least one Booked order ÷ approved calls. Average = booked value ÷ booked calls. Tentative orders are not counted; approved reports only. All dates use Asia/Kolkata.</p>
      </section>
      {data.overdue > 0 && (
        <Link to="/followups" className="mt-3 block rounded-2xl bg-warning-soft p-4 text-sm font-medium text-warning">
          {data.overdue} follow-up{data.overdue > 1 ? "s are" : " is"} overdue →
        </Link>
      )}

      {data.recentDrafts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Awaiting your approval</h2>
          <div className="space-y-2">
            {data.recentDrafts.map((d) => (
              <Link
                key={d.id}
                to="/review/$id"
                params={{ id: d.id }}
                className="flex min-h-16 items-center justify-between rounded-2xl bg-card p-4 shadow-card"
              >
                <div>
                  <div className="font-medium">{d.doctor_name ?? "Doctor not confirmed"}</div>
                  <div className="text-xs text-muted-foreground">Created {fmtDateTime(d.created_at)}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
