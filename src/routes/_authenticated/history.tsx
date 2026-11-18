import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Search, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, StatusBadge, fmtDate, fmtDateTime } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { exportApprovedCsv, getMasterData, listReports } from "@/lib/reports.functions";
import { todayIST } from "@/lib/report-rules";

const masterQ = queryOptions({ queryKey: ["master"], queryFn: () => getMasterData(), staleTime: Infinity });

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Call history — FieldIQ Pharma" },
      { name: "description", content: "Search and filter your doctor-call reports and export approved ones." },
      { property: "og:title", content: "Call history — FieldIQ Pharma" },
      { property: "og:description", content: "Search and filter your doctor-call reports." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(masterQ),
  component: HistoryPage,
});

const field = "h-12 w-full rounded-xl border bg-card px-3 text-base";

function HistoryPage() {
  const { data: master } = useSuspenseQuery(masterQ);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "approved">("all");
  const [doctorId, setDoctorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { q, status, doctorId: doctorId || undefined, from: from || undefined, to: to || undefined };
  const { data, isFetching } = useQuery({
    queryKey: ["reports", filters],
    queryFn: () => listReports({ data: filters }),
  });
  const exportFn = useServerFn(exportApprovedCsv);

  async function doExport() {
    try {
      const csv = await exportFn();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `fieldiq-approved-${todayIST()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Call history"
        action={
          <Button variant="outline" className="h-11 rounded-xl" onClick={doExport}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        }
      />
      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        <input className={field + " pl-10"} placeholder="Search doctor, purpose, note" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(["all", "draft", "approved"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`h-11 rounded-xl text-sm font-medium capitalize ${status === s ? "bg-primary text-primary-foreground" : "bg-card text-foreground border"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <select className={field + " mt-2"} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
        <option value="">All doctors</option>
        {master.doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {!data && isFetching && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No reports match.</p>}
        {data?.map((r) => (
          <Link
            key={r.id}
            to="/review/$id"
            params={{ id: r.id }}
            className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-card"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{r.doctor_name ?? "Doctor not confirmed"}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {fmtDateTime(r.call_datetime) ?? (r.call_date_only ? fmtDate(r.call_date_only) + " · time unknown" : "Date unknown")}
              </div>
              {!r.is_owner && <div className="mt-1 text-xs text-muted-foreground">Rep: {r.rep_name}</div>}
              {r.product_names.length > 0 && <div className="mt-1 truncate text-sm">{r.product_names.join(", ")}</div>}
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
