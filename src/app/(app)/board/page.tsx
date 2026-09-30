import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { KANBAN_COLUMNS, isOverdue } from "@/lib/status";
import { PageHeader, ProgressBar } from "@/components/ui/misc";
import { OverdueBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatRelative, todayIso } from "@/lib/utils";
import { orderHref } from "@/components/orders/order-table";

export const metadata = { title: "Production Board" };

export default async function BoardPage() {
  await requireAdmin();
  const today = todayIso();
  const statuses = KANBAN_COLUMNS.flatMap((c) => c.statuses);
  const orders = await prisma.order.findMany({
    where: { status: { in: statuses } },
    include: { customer: { select: { name: true } }, engineer: { select: { name: true } }, currentStage: { select: { name: true } } },
    orderBy: [{ expectedCompletionDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });

  return (
    <div>
      <PageHeader title="Production board" description="Where every machine is right now. Cards are ordered by expected completion." />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="grid min-w-max auto-cols-[17rem] grid-flow-col gap-3">
          {KANBAN_COLUMNS.map((col) => {
            const cards = orders.filter((o) => (col.statuses as string[]).includes(o.status));
            return (
              <section key={col.key} className="flex flex-col rounded-lg border border-border bg-surface-2" aria-label={col.label}>
                <header className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide">{col.label}</h2>
                  <span className="tabular rounded bg-surface px-1.5 text-xs font-semibold text-muted">{cards.length}</span>
                </header>
                <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-2 overflow-y-auto p-2">
                  {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-subtle">No orders</p>}
                  {cards.map((o) => {
                    const overdue = isOverdue(o.expectedCompletionDate, o.status, today);
                    return (
                      <Link key={o.id} href={orderHref(o)} className={`block rounded-md border bg-surface p-3 text-sm shadow-sm hover:border-border-strong ${overdue ? "border-[var(--tone-danger-fg)]/40" : "border-border"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold">{o.orderNumber ?? "Draft PO"}</span>
                          {overdue ? <OverdueBadge /> : col.statuses.length > 1 ? <StatusBadge status={o.status} /> : null}
                        </div>
                        <div className="mt-1 truncate text-muted">{o.customer?.name ?? "Unmatched customer"}</div>
                        <div className="truncate">{o.machineName ?? "—"}</div>
                        {o.currentStage && <div className="mt-1 text-xs text-muted">Stage: {o.currentStage.name}</div>}
                        <ProgressBar value={o.progressPercentage} className="mt-2" />
                        <div className="mt-2 flex items-center justify-between text-[11px] text-subtle">
                          <span>{o.engineer?.name ?? "Unassigned"}</span>
                          <span title="Expected completion">{o.expectedCompletionDate ? `Due ${formatDate(o.expectedCompletionDate)}` : formatRelative(o.lastUpdateAt ?? o.createdAt)}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
