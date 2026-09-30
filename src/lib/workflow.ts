import type { OrderStatusValue } from "./status";

export type RoleValue = "ADMIN" | "ENGINEER";

/**
 * Controlled order lifecycle. Every status change in the system goes through
 * one of these actions; each action is limited to specific roles and source
 * statuses so nobody can jump arbitrarily between states.
 */
export const WORKFLOW = {
  START_REVIEW: { roles: ["ADMIN"], from: ["PO_RECEIVED"], label: "Start review" },
  APPROVE: { roles: ["ADMIN"], from: ["PO_RECEIVED", "PO_UNDER_REVIEW"], label: "Approve & create order" },
  ASSIGN: { roles: ["ADMIN"], from: ["ORDER_CREATED"], label: "Assign engineer" },
  REASSIGN: {
    roles: ["ADMIN"],
    from: ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"],
    label: "Reassign engineer",
  },
  ACCEPT: { roles: ["ENGINEER"], from: ["ASSIGNED"], label: "Accept order" },
  PROGRESS_UPDATE: {
    roles: ["ENGINEER"],
    from: ["ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"],
    label: "Update progress",
  },
  UPLOAD_PHOTO: {
    roles: ["ENGINEER"],
    from: ["ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING", "COMPLETED"],
    label: "Upload photos",
  },
  MARK_COMPLETED: { roles: ["ENGINEER"], from: ["ASSEMBLY_IN_PROGRESS", "TESTING"], label: "Mark machine completed" },
  SUBMIT_PHOTOS: { roles: ["ENGINEER"], from: ["COMPLETED"], label: "Submit photos & send summary" },
  MARK_PACKED: { roles: ["ADMIN"], from: ["PHOTOS_UPLOADED"], label: "Mark as packed" },
  MARK_READY: { roles: ["ADMIN"], from: ["PACKED"], label: "Mark ready for dispatch" },
  MARK_DISPATCHED: { roles: ["ADMIN"], from: ["READY_FOR_DISPATCH"], label: "Mark dispatched" },
  CLOSE: { roles: ["ADMIN"], from: ["DISPATCHED"], label: "Close order" },
  HOLD: {
    roles: ["ADMIN"],
    from: [
      "ORDER_CREATED",
      "ASSIGNED",
      "ACCEPTED",
      "ASSEMBLY_IN_PROGRESS",
      "TESTING",
      "COMPLETED",
      "PHOTOS_UPLOADED",
      "PACKED",
      "READY_FOR_DISPATCH",
    ],
    label: "Put on hold",
  },
  RESUME: { roles: ["ADMIN"], from: ["ON_HOLD"], label: "Resume" },
  CANCEL: {
    roles: ["ADMIN"],
    from: [
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
      "ON_HOLD",
    ],
    label: "Cancel order",
  },
  EDIT: {
    roles: ["ADMIN"],
    from: [
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
      "ON_HOLD",
    ],
    label: "Edit order",
  },
} as const satisfies Record<string, { roles: readonly RoleValue[]; from: readonly OrderStatusValue[]; label: string }>;

export type WorkflowAction = keyof typeof WORKFLOW;

export function canPerform(action: WorkflowAction, role: RoleValue, status: OrderStatusValue): boolean {
  const rule = WORKFLOW[action];
  return (rule.roles as readonly string[]).includes(role) && (rule.from as readonly string[]).includes(status);
}

export function availableActions(role: RoleValue, status: OrderStatusValue): WorkflowAction[] {
  return (Object.keys(WORKFLOW) as WorkflowAction[]).filter((a) => canPerform(a, role, status));
}

/** Work status that follows from the stage the engineer is currently on. */
export function workStatusForPhase(phase: "ASSEMBLY" | "TESTING" | "FINAL"): OrderStatusValue {
  return phase === "ASSEMBLY" ? "ASSEMBLY_IN_PROGRESS" : "TESTING";
}

export const MAX_MACHINE_PHOTOS = 8;
export const MAX_PROGRESS_PHOTOS_PER_UPDATE = 4;
