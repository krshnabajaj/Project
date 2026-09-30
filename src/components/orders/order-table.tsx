import Link from "next/link";
import { ArrowDown, ArrowUp, AlertTriangle, Copy } from "lucide-react";
import { OverdueBadge, StatusBadge } from "@/components/ui/badge";
import { ProgressBar, Table, Td, Th, EmptyState } from "@/components/ui/misc";
import { formatDate, formatRelative } from "@/lib/utils";
import { isOverdue } from "@/lib/status";
import type { OrderListRow } from "@/server/services/queries";

const COLUMNS: { key: string; label: string; sort?: string; className?: string }[] = [
  { key: "order", label: "Order", sort: "order" },
  { key: "customer", label: "Customer", sort: "customer" },
  { key: "machine", label: "Machine", sort: "machine" },
  { key: "engineer", label: "Engineer", sort: "engineer" },
  { key: "status", label: "Status", sort: "status" },
  { key: "stage", label: "Stage" },
  { key: "progress", label: "Progress", sort: "progress", className: "min-w-32" },
  { key: "poDate", label: "PO Date", sort: "poDate" },
  { key: "expected", label: "Expected Completion", sort: "expected" },
  { key: "lastUpdate", label: "Last Update", sort: "lastUpdate" },
];

export function orderHref(o: { id: string; status: string }) {
  return ["PO_RECEIVED", "PO_UNDER_REVIEW"].includes(o.status) ? `/purchase-orders/${o.id}` : `/orders/${o.id}`;
}

export function OrderTable({
  rows,
  today,
  searchParams,
  basePath = "/orders",
}: {
  rows: OrderListRow[];
  today: string;
  searchParams: Record<string, string | undefined>;
  basePath?: string;
}) {
  const sortHref = (key: string) => {
    const p = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v !== undefined) as [string, string][]);
    const same = p.get("sort") === key;
    p.set("sort", key);
    p.set("dir", same && p.get("dir") === "asc" ? "desc" : "asc");
    p.delete("page");
    return `${basePath}?${p.toString()}`;
  };
  if (!rows.length) return <EmptyState title="No orders match these filters." />;
  return (
    <Table>
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <Th key={c.key} className={c.className} aria-sort={searchParams.sort === c.sort ? (searchParams.dir === "asc" ? "ascending" : "descending") : undefined}>
              {c.sort ? (
                <Link href={sortHref(c.sort)} className="inline-flex items-center gap-1 hover:text-foreground">
                  {c.label}
                  {searchParams.sort === c.sort && (searchParams.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </Link>
              ) : (
                c.label
              )}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const overdue = isOverdue(o.expectedCompletionDate, o.status, today);
          const po = o.purchaseOrders[0];
          const review = ["PO_RECEIVED", "PO_UNDER_REVIEW"].includes(o.status);
          return (
            <tr key={o.id} className="hover:bg-surface-2/60">
              <Td className="whitespace-nowrap">
                <Link href={orderHref(o)} className="font-semibold text-accent hover:underline">
                  {o.orderNumber ?? "Draft PO"}
                </Link>
                <div className="flex items-center gap-1 text-xs text-muted">
                  {o.poNumber ? `PO ${o.poNumber}` : "PO —"}
                  {po?.duplicateStatus === "SUSPECTED" && <Copy className="size-3 text-[var(--tone-warning-fg)]" aria-label="Possible duplicate" />}
                  {po && review && (po.extractionStatus === "PARTIAL" || po.extractionStatus === "FAILED") && (
                    <AlertTriangle className="size-3 text-[var(--tone-warning-fg)]" aria-label="Needs review" />
                  )}
                </div>
              </Td>
              <Td className="max-w-48 truncate">{o.customer?.name ?? <span className="text-subtle">Unmatched</span>}</Td>
              <Td className="max-w-56">
                <div className="truncate">{o.machineName ?? "—"}</div>
                {o.quantity ? <div className="text-xs text-muted">Qty {o.quantity}</div> : null}
              </Td>
              <Td className="whitespace-nowrap">{o.engineer?.name ?? <span className="text-subtle">Unassigned</span>}</Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge status={o.status} />
                  {overdue && <OverdueBadge />}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-muted">{o.currentStage?.name ?? "—"}</Td>
              <Td>
                <ProgressBar value={o.progressPercentage} />
              </Td>
              <Td className="tabular whitespace-nowrap">{formatDate(o.poDate)}</Td>
              <Td className={`tabular whitespace-nowrap ${overdue ? "font-semibold text-[var(--tone-danger-fg)]" : ""}`}>{formatDate(o.expectedCompletionDate)}</Td>
              <Td className="whitespace-nowrap text-muted" title={o.lastUpdateAt?.toISOString()}>
                {formatRelative(o.lastUpdateAt)}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
