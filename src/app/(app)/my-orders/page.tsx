import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { engineerDashboard } from "@/server/services/queries";
import { EngineerOrderCard } from "@/components/orders/engineer-order-card";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { isOverdue } from "@/lib/status";
import { addDaysIso, cn, toIsoDate } from "@/lib/utils";

export const metadata = { title: "My Orders" };

const FILTERS = [
  { key: "all", label: "All active" },
  { key: "assigned", label: "Assigned to me" },
  { key: "accepted", label: "Accepted" },
  { key: "progress", label: "In progress" },
  { key: "due", label: "Due soon" },
  { key: "overdue", label: "Overdue" },
] as const;

export default async function MyOrdersPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requireUser("ENGINEER");
  const { f = "all" } = await searchParams;
  const { orders, today } = await engineerDashboard(user);
  const active = orders.filter((o) => ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING", "COMPLETED", "ON_HOLD"].includes(o.status));
  const soon = addDaysIso(today, 7);
  const groups: Record<string, typeof active> = {
    all: active,
    assigned: active.filter((o) => o.status === "ASSIGNED"),
    accepted: active.filter((o) => o.status === "ACCEPTED"),
    progress: active.filter((o) => ["ASSEMBLY_IN_PROGRESS", "TESTING"].includes(o.status)),
    due: active.filter((o) => o.expectedCompletionDate && toIsoDate(o.expectedCompletionDate) >= today && toIsoDate(o.expectedCompletionDate) <= soon && o.status !== "COMPLETED"),
    overdue: active.filter((o) => isOverdue(o.expectedCompletionDate, o.status, today)),
  };
  const list = groups[f] ?? active;
  const completedCount = orders.filter((o) => !["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING", "COMPLETED", "ON_HOLD"].includes(o.status)).length;
  const needsUpdate = active.filter((o) => ["ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"].includes(o.status) && (!o.lastUpdateAt || toIsoDate(o.lastUpdateAt) < today));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} description={`${active.length} active order${active.length === 1 ? "" : "s"} · ${completedCount} completed`} />
      {needsUpdate.length > 0 && (
        <Alert tone="warning" className="mb-4" title="End-of-day update due">
          {needsUpdate.map((o) => o.orderNumber).join(", ")} {needsUpdate.length === 1 ? "has" : "have"} no update today.
        </Alert>
      )}
      <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/my-orders?f=${x.key}`}
            className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", f === x.key ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface")}
          >
            {x.label} <span className="tabular opacity-70">{groups[x.key]?.length ?? 0}</span>
          </Link>
        ))}
        <Link href="/my-orders/completed" className="whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm">
          Completed <span className="opacity-70">{completedCount}</span>
        </Link>
      </nav>
      {list.length === 0 ? (
        <EmptyState title="Nothing here.">New assignments appear here and in your notifications.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((o) => (
            <EngineerOrderCard key={o.id} o={o} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}
