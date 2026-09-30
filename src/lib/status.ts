// Client-safe status metadata. Mirrors the Prisma OrderStatus enum.
export const ORDER_STATUSES = [
  "PO_RECEIVED",
  "PO_UNDER_REVIEW",
  "ORDER_CREATED",
  "ASSIGNED",
  "ACCEPTED",
  "ASSEMBLY_IN_PROGRESS",
  "TESTING",
  "COMPLETED",
  "PHOTOS_UPLOADED",
  "PACKED",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "CLOSED",
  "ON_HOLD",
  "CANCELLED",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export type Tone = "neutral" | "info" | "progress" | "warning" | "success" | "danger" | "muted" | "accent";

export const STATUS_META: Record<OrderStatusValue, { label: string; tone: Tone; description: string }> = {
  PO_RECEIVED: { label: "PO Received", tone: "accent", description: "Imported purchase order awaiting admin review" },
  PO_UNDER_REVIEW: { label: "PO Under Review", tone: "accent", description: "Admin is reviewing extracted PO data" },
  ORDER_CREATED: { label: "Order Created", tone: "warning", description: "Approved — awaiting engineer assignment" },
  ASSIGNED: { label: "Assigned", tone: "info", description: "Assigned to an engineer, awaiting acceptance" },
  ACCEPTED: { label: "Accepted", tone: "info", description: "Engineer accepted the order" },
  ASSEMBLY_IN_PROGRESS: { label: "Assembly In Progress", tone: "progress", description: "Machine is being assembled" },
  TESTING: { label: "Testing", tone: "progress", description: "Machine is under testing / inspection" },
  COMPLETED: { label: "Completed", tone: "success", description: "Machine completed — photographs pending" },
  PHOTOS_UPLOADED: { label: "Photos Uploaded", tone: "success", description: "Completion photos submitted and summary emailed" },
  PACKED: { label: "Packed", tone: "success", description: "Machine packed" },
  READY_FOR_DISPATCH: { label: "Ready for Dispatch", tone: "success", description: "Packed and ready to ship" },
  DISPATCHED: { label: "Dispatched", tone: "muted", description: "Shipped to customer" },
  CLOSED: { label: "Closed", tone: "muted", description: "Order closed" },
  ON_HOLD: { label: "On Hold", tone: "warning", description: "Paused by admin" },
  CANCELLED: { label: "Cancelled", tone: "danger", description: "Cancelled / rejected" },
};

export const REVIEW_STATUSES: OrderStatusValue[] = ["PO_RECEIVED", "PO_UNDER_REVIEW"];
export const IN_PRODUCTION_STATUSES: OrderStatusValue[] = ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"];
export const ENGINEER_ACTIVE_STATUSES: OrderStatusValue[] = ["ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"];
export const COMPLETED_STATUSES: OrderStatusValue[] = ["COMPLETED", "PHOTOS_UPLOADED"];
export const TERMINAL_STATUSES: OrderStatusValue[] = ["DISPATCHED", "CLOSED", "CANCELLED"];
/** Orders whose expected completion date matters (machine not yet completed). */
export const OVERDUE_ELIGIBLE_STATUSES: OrderStatusValue[] = [
  "ORDER_CREATED",
  "ASSIGNED",
  "ACCEPTED",
  "ASSEMBLY_IN_PROGRESS",
  "TESTING",
  "ON_HOLD",
];
/** Statuses shown on the default "open orders" views (everything until dispatched). */
export const OPEN_STATUSES: OrderStatusValue[] = ORDER_STATUSES.filter(
  (s) => !TERMINAL_STATUSES.includes(s),
) as OrderStatusValue[];

/** Production pipeline (dashboard) — ordered left to right. */
export const PIPELINE: { key: string; label: string; statuses: OrderStatusValue[] }[] = [
  { key: "review", label: "PO Received", statuses: ["PO_RECEIVED", "PO_UNDER_REVIEW"] },
  { key: "created", label: "Awaiting Engineer", statuses: ["ORDER_CREATED"] },
  { key: "assigned", label: "Assigned", statuses: ["ASSIGNED", "ACCEPTED"] },
  { key: "assembly", label: "Assembly", statuses: ["ASSEMBLY_IN_PROGRESS"] },
  { key: "testing", label: "Testing", statuses: ["TESTING"] },
  { key: "completed", label: "Completed", statuses: ["COMPLETED", "PHOTOS_UPLOADED"] },
  { key: "packed", label: "Packed", statuses: ["PACKED"] },
  { key: "ready", label: "Ready Dispatch", statuses: ["READY_FOR_DISPATCH"] },
  { key: "dispatched", label: "Dispatched", statuses: ["DISPATCHED"] },
];

/** Kanban board columns. */
export const KANBAN_COLUMNS = PIPELINE.filter((c) => c.key !== "dispatched");

export function statusLabel(s: string): string {
  return STATUS_META[s as OrderStatusValue]?.label ?? s;
}

/**
 * An order is overdue when its expected completion date is before today
 * (business-timezone date, YYYY-MM-DD) and the machine is not yet completed.
 */
export function isOverdue(
  expected: Date | string | null | undefined,
  status: string,
  todayIso: string,
): boolean {
  if (!expected || !OVERDUE_ELIGIBLE_STATUSES.includes(status as OrderStatusValue)) return false;
  const expIso = typeof expected === "string" ? expected.slice(0, 10) : expected.toISOString().slice(0, 10);
  return expIso < todayIso;
}
