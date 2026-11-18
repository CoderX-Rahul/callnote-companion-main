import { Link, useNavigate } from "@tanstack/react-router";
import { Home, PlusCircle, History, CalendarCheck, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/new", label: "New call", icon: PlusCircle },
  { to: "/history", label: "History", icon: History },
  { to: "/followups", label: "Follow-ups", icon: CalendarCheck },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-background">
      <div className="flex justify-end px-4 pt-2">
        <Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={signOut}>
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="h-6 w-6" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return status === "approved" ? (
    <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">Approved</span>
  ) : (
    <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">Draft</span>
  );
}

export function fmtDateTime(s: string | null) {
  if (!s) return null;
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}
export function fmtDate(s: string | null) {
  if (!s) return null;
  return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { dateStyle: "medium" });
}
