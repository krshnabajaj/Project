import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { orderScope } from "@/server/services/access";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Completed orders" };

export default async function CompletedPage() {
  const user = await requireUser("ENGINEER");
  const orders = await prisma.order.findMany({
    where: { ...orderScope(user), completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    include: { customer: { select: { name: true } }, _count: { select: { images: { where: { kind: "MACHINE" } } } } },
  });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My completed orders" description={`${orders.length} machine${orders.length === 1 ? "" : "s"} completed`} />
      <Card>
        {orders.length === 0 ? (
          <EmptyState title="No completed machines yet." />
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="font-medium">{o.orderNumber}</div>
                    <div className="truncate text-sm text-muted">
                      {o.customer?.name} · {o.machineName}
                    </div>
                    <div className="text-xs text-subtle">
                      Completed {formatDate(o.completedAt)} · {o._count.images} photos
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
