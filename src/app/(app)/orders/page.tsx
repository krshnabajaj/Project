import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { listOrders } from "@/server/services/queries";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { OrderFilters } from "@/components/orders/order-filters";
import { OrderTable } from "@/components/orders/order-table";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total, pageSize, today }, engineers, customers] = await Promise.all([
    listOrders(
      {
        q: sp.q,
        status: sp.status,
        engineerId: sp.engineer,
        customerId: sp.customer,
        from: sp.from,
        to: sp.to,
        delayed: sp.delayed === "1",
        sort: sp.sort ?? "created",
        dir: sp.dir === "asc" ? "asc" : "desc",
        page,
      },
      user,
    ),
    prisma.user.findMany({ where: { role: "ENGINEER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `/orders?${q.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Orders"
        description={`${total} order${total === 1 ? "" : "s"} · orders stay visible until dispatched`}
        actions={
          <Link href="/orders/new" className={buttonVariants()}>
            <Plus /> New order
          </Link>
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <OrderFilters engineers={engineers} customers={customers} exportable />
        </div>
        <OrderTable rows={rows} today={today} searchParams={sp} />
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={pageHref(page - 1)}>
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={pageHref(page + 1)}>
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
