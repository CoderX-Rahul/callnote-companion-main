import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { AppShell, PageHeader, fmtDate } from "@/components/AppShell";
import { listFollowUps, setFollowUpDone } from "@/lib/reports.functions";
import { todayIST } from "@/lib/report-rules";

const fuQ = queryOptions({ queryKey: ["followups"], queryFn: () => listFollowUps() });

export const Route = createFileRoute("/_authenticated/followups")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Follow-ups — FieldIQ Pharma" },
      { name: "description", content: "Upcoming follow-up tasks from approved doctor-call reports." },
      { property: "og:title", content: "Follow-ups — FieldIQ Pharma" },
      { property: "og:description", content: "Upcoming follow-up tasks from approved call reports." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fuQ),
  component: FollowUps,
});

function FollowUps() {
  const { data } = useSuspenseQuery(fuQ);
  const toggle = useServerFn(setFollowUpDone);
  const qc = useQueryClient();
  const today = todayIST();
  const open = data.filter((f) => !f.follow_up_done);
  const done = data.filter((f) => f.follow_up_done);

  async function set(id: string, v: boolean) {
    await toggle({ data: { id, done: v } });
    qc.invalidateQueries();
  }

  const Item = ({ f }: { f: (typeof data)[number] }) => {
    const overdue = !f.follow_up_done && f.follow_up_due && f.follow_up_due < today;
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card">
        {f.is_owner && (
          <button
            aria-label={f.follow_up_done ? "Mark not done" : "Mark done"}
            onClick={() => set(f.id, !f.follow_up_done)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${f.follow_up_done ? "border-success bg-success text-primary-foreground" : "border-input"}`}
          >
            {f.follow_up_done && <Check className="h-5 w-5" />}
          </button>
        )}
        <Link to="/review/$id" params={{ id: f.id }} className="min-w-0 flex-1">
          <div className={`font-medium ${f.follow_up_done ? "line-through text-muted-foreground" : ""}`}>{f.follow_up_action}</div>
          <div className="text-xs text-muted-foreground">
            {f.doctor_name} ·{" "}
            <span className={overdue ? "font-semibold text-destructive" : ""}>
              {f.follow_up_due ? `Due ${fmtDate(f.follow_up_due)}${overdue ? " (overdue)" : ""}` : "No due date"}
            </span>
          </div>
          {!f.is_owner && <div className="text-xs text-muted-foreground">Rep: {f.rep_name}</div>}
        </Link>
      </div>
    );
  };

  return (
    <AppShell>
      <PageHeader title="Follow-ups" subtitle="From approved reports" />
      {open.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing pending. 🎉</p>}
      <div className="space-y-2">{open.map((f) => <Item key={f.id} f={f} />)}</div>
      {done.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">Completed</h2>
          <div className="space-y-2">{done.map((f) => <Item key={f.id} f={f} />)}</div>
        </>
      )}
    </AppShell>
  );
}
