import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { adminDashboard, listOrders } from "@/server/services/queries";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFilters } from "@/components/orders/order-filters";
import { formatTime, formatDate, cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function Kpi({ label, value, href, tone, hint }: { label: string; value: number; href: string; tone?: "danger" | "warning" | "accent"; hint?: string }) {
  return (
    <Link href={href} className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div
        className={cn(
          "tabular mt-1 text-3xl font-semibold tracking-tight",
          tone === "danger" && value > 0 && "text-[var(--tone-danger-fg)]",
          tone === "warning" && value > 0 && "text-[var(--tone-warning-fg)]",
          tone === "accent" && value > 0 && "text-[var(--tone-accent-fg)]",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const [{ kpis, pipeline, recent, workload, today }, table, engineers, customers] = await Promise.all([
    adminDashboard(),
    listOrders(
      {
        q: sp.q,
        status: sp.status ?? "open",
        engineerId: sp.engineer,
        customerId: sp.customer,
        from: sp.from,
        to: sp.to,
        delayed: sp.delayed === "1",
        sort: sp.sort ?? "expected",
        dir: sp.dir === "desc" ? "desc" : "asc",
        pageSize: 25,
      },
      user,
    ),
    prisma.user.findMany({ where: { role: "ENGINEER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const activeEngineers = workload.filter((w) => w.active);
  const maxLoad = Math.max(1, ...activeEngineers.map((w) => w.openLoad));
  const maxPipe = Math.max(1, ...pipeline.map((p) => p.count));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Production dashboard"
        description={`Today, ${formatDate(today)}`}
        actions={
          <Link href="/orders/new" className={buttonVariants()}>
            <Plus /> New order
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Total orders" value={kpis.total} href="/orders?status=all" hint={`${kpis.open} open`} />
        <Kpi label="New POs" value={kpis.newPos} href="/purchase-orders" tone="accent" hint="Require review" />
        <Kpi label="Awaiting engineer" value={kpis.awaitingEngineer} href="/orders?status=ORDER_CREATED" tone="warning" />
        <Kpi label="In progress" value={kpis.inProgress} href="/orders?status=production" />
        <Kpi label="Machines completed" value={kpis.completed} href="/orders?status=completed" hint="Awaiting packing" />
        <Kpi label="Ready for dispatch" value={kpis.readyForDispatch} href="/dispatch" />
        <Kpi label="Overdue" value={kpis.overdue} href="/orders?status=overdue" tone="danger" hint="Past expected completion" />
      </div>

      {/* Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>Production pipeline</CardTitle>
          <Link href="/board" className="flex items-center text-xs text-accent hover:underline">
            Open board <ChevronRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {pipeline.map((p, i) => (
              <li key={p.key}>
                <Link
                  href={`/orders?status=${p.statuses.length === 1 ? p.statuses[0] : p.key === "review" ? "review" : p.key === "completed" ? "completed" : p.statuses[0]}`}
                  className="block rounded-md border border-border p-2.5 hover:bg-surface-2"
                  title={`${p.label}: ${p.count} order(s)`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <span className="text-subtle">{i + 1}.</span> <span className="truncate">{p.label}</span>
                  </div>
                  <div className="tabular mt-1 text-2xl font-semibold">{p.count}</div>
                  <div className="mt-1.5 h-1 rounded-full bg-bar-track">
                    <div className="h-full rounded-full bg-bar" style={{ width: `${(p.count / maxPipe) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Engineer workload */}
        <Card>
          <CardHeader>
            <CardTitle>Engineer workload</CardTitle>
            <span className="text-xs text-muted">Open orders per engineer</span>
          </CardHeader>
          <CardContent>
            {activeEngineers.length === 0 ? (
              <EmptyState title="No active engineers.">Add engineers in Engineers.</EmptyState>
            ) : (
              <ul className="space-y-2.5">
                {activeEngineers.map((e) => (
                  <li key={e.id}>
                    <Link href={`/engineers/${e.id}`} className="group grid grid-cols-[7rem_1fr_auto] items-center gap-3" title={`${e.name}: ${e.assigned} assigned, ${e.inProgress} in progress, ${e.overdue} overdue`}>
                      <span className="truncate text-sm group-hover:underline">{e.name}</span>
                      <span className="h-2.5 rounded-sm bg-bar-track">
                        <span className="block h-full rounded-sm bg-bar" style={{ width: `${(e.openLoad / maxLoad) * 100}%` }} />
                      </span>
                      <span className="tabular w-28 text-right text-xs text-muted">
                        <span className="font-semibold text-foreground">{e.openLoad}</span> open
                        {e.overdue > 0 && <span className="ml-1 font-semibold text-[var(--tone-danger-fg)]">· {e.overdue} overdue</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link href="/audit" className="text-xs text-accent hover:underline">
              Audit trail
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState title="No activity yet." />
            ) : (
              <ul className="space-y-2 text-sm">
                {recent.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="tabular w-16 shrink-0 text-xs text-muted">{formatTime(a.createdAt)}</span>
                    <span className="min-w-0">
                      {a.order ? (
                        <Link href={`/orders/${a.order.id}`} className="font-medium text-accent hover:underline">
                          {a.order.orderNumber ?? "Draft PO"}
                        </Link>
                      ) : null}{" "}
                      <span className="text-muted">— {a.summary}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main order table */}
      <Card>
        <CardHeader>
          <CardTitle>Open orders</CardTitle>
          <Link href="/orders" className="flex items-center text-xs text-accent hover:underline">
            All orders <ChevronRight className="size-3" />
          </Link>
        </CardHeader>
        <div className="border-b border-border p-3">
          <OrderFilters engineers={engineers} customers={customers} />
        </div>
        <OrderTable rows={table.rows} today={today} searchParams={{ ...sp, sort: sp.sort ?? "expected", dir: sp.dir ?? "asc" }} basePath="/dashboard" />
        {table.total > table.rows.length && (
          <div className="border-t border-border px-4 py-2 text-right text-xs">
            <Link href="/orders" className="text-accent hover:underline">
              Showing {table.rows.length} of {table.total} — view all
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
