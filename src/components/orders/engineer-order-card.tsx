import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { OverdueBadge, StatusBadge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { isOverdue } from "@/lib/status";
import { canPerform } from "@/lib/workflow";
import { formatDate, formatRelative } from "@/lib/utils";
import type { OrderStatus } from "@prisma/client";

export interface EngineerCardOrder {
  id: string;
  orderNumber: string | null;
  status: OrderStatus;
  machineName: string | null;
  quantity: number | null;
  progressPercentage: number;
  expectedCompletionDate: Date | null;
  lastUpdateAt: Date | null;
  customer: { name: string } | null;
  currentStage: { name: string } | null;
}

export function EngineerOrderCard({ o, today }: { o: EngineerCardOrder; today: string }) {
  const overdue = isOverdue(o.expectedCompletionDate, o.status, today);
  const canUpdate = canPerform("PROGRESS_UPDATE", "ENGINEER", o.status);
  return (
    <article className={`rounded-lg border bg-surface p-4 shadow-sm ${overdue ? "border-[var(--tone-danger-fg)]/50" : "border-border"}`}>
      <Link href={`/orders/${o.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold">{o.orderNumber}</div>
            <div className="text-sm text-muted">{o.customer?.name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={o.status} />
            {overdue && <OverdueBadge />}
          </div>
        </div>
        <div className="mt-2 text-sm font-medium">
          {o.machineName}
          {o.quantity ? <span className="text-muted"> × {o.quantity}</span> : null}
        </div>
        <div className="mt-1 text-sm text-muted">Stage: {o.currentStage?.name ?? "Not started"}</div>
        <ProgressBar value={o.progressPercentage} className="mt-2" />
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span className={overdue ? "font-semibold text-[var(--tone-danger-fg)]" : ""}>Due {formatDate(o.expectedCompletionDate)}</span>
          <span>Updated {formatRelative(o.lastUpdateAt)}</span>
        </div>
      </Link>
      {o.status === "ASSIGNED" && (
        <Link href={`/orders/${o.id}`} className={buttonVariants({ size: "xl", variant: "success", className: "mt-3 w-full" })}>
          Review & accept
        </Link>
      )}
      {canUpdate && (
        <Link href={`/orders/${o.id}/update`} className={buttonVariants({ size: "xl", className: "mt-3 w-full" })}>
          <ClipboardCheck /> UPDATE PROGRESS
        </Link>
      )}
      {o.status === "COMPLETED" && (
        <Link href={`/orders/${o.id}/complete`} className={buttonVariants({ size: "xl", className: "mt-3 w-full" })}>
          Submit completion photos
        </Link>
      )}
    </article>
  );
}
