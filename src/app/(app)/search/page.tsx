import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { globalSearch } from "@/server/services/queries";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { orderHref } from "@/components/orders/order-table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const rows = await globalSearch(q, user, 100);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Search: “${q}”`} description={`${rows.length} result(s) across order number, PO number, customer, machine and engineer`} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No matching orders.">Try a PO number (e.g. PO-4587), order number, customer or machine name.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <li key={o.id}>
                <Link href={user.role === "ADMIN" ? orderHref(o) : `/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {o.orderNumber ?? "Draft PO"} <span className="font-normal text-muted">· PO {o.poNumber ?? "—"}</span>
                    </div>
                    <div className="truncate text-sm text-muted">{[o.customer?.name, o.machineName, o.engineer?.name].filter(Boolean).join(" · ")}</div>
                    <div className="text-xs text-subtle">PO date {formatDate(o.poDate)}</div>
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
