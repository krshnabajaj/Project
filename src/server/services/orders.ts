import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { canPerform, WORKFLOW, type WorkflowAction } from "@/lib/workflow";
import { statusLabel } from "@/lib/status";
import { dateOnly, formatDate } from "@/lib/utils";
import { orderInputSchema, type OrderInput, type CustomerInput } from "@/lib/schemas";
import type { Actor } from "../actor";
import { audit, AUDIT, diff } from "../audit";
import { assertAdmin, assertAssignedEngineer, lockOrder } from "./access";
import { nextOrderNumber } from "./order-number";
import { findDuplicateCandidates, emailDomain, type DuplicateCandidate } from "./duplicates";
import { deliverNotifications, notifyAdminsInApp, notifyUserInApp, queueWhatsApp } from "./notifications";
import { messages, orderRef } from "./messages";
import { getSetting } from "../settings";

// ------------------------------------------------------------------ helpers

export function describeActor(actor: Actor) {
  return actor.name;
}

/**
 * Guarded status change: re-checks the rule against the *current* row inside the
 * transaction and uses a conditional update, so concurrent requests cannot skip states.
 */
export async function transition(
  tx: Tx,
  orderId: string,
  action: WorkflowAction,
  actor: Actor,
  to: OrderStatus,
  data: Prisma.OrderUncheckedUpdateInput = {},
): Promise<Order> {
  await lockOrder(tx, orderId);
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found.", "NOT_FOUND");
  const role = actor.role === "SYSTEM" ? "ADMIN" : actor.role;
  if (!canPerform(action, role, order.status)) {
    const allowedRoles = WORKFLOW[action].roles as readonly string[];
    if (!allowedRoles.includes(role)) throw new AppError(`Only ${allowedRoles.join("/").toLowerCase()}s can ${WORKFLOW[action].label.toLowerCase()}.`, "FORBIDDEN");
    throw new AppError(
      `Cannot ${WORKFLOW[action].label.toLowerCase()} while the order is "${statusLabel(order.status)}".`,
      "INVALID_TRANSITION",
    );
  }
  const updated = await tx.order.update({ where: { id: orderId }, data: { ...data, status: to } });
  if (order.status !== to) {
    await audit(tx, actor, {
      action: AUDIT.STATUS_CHANGED,
      summary: `${actor.name} changed status from ${statusLabel(order.status)} to ${statusLabel(to)}`,
      orderId,
      entityType: "order",
      entityId: orderId,
      oldValue: { status: order.status },
      newValue: { status: to },
    });
  }
  return updated;
}

function orderData(input: OrderInput) {
  const d = (v: string | null) => (v ? dateOnly(v) : null);
  return {
    poNumber: input.poNumber,
    poDate: d(input.poDate),
    deliveryDate: d(input.deliveryDate),
    paymentTerms: input.paymentTerms,
    referenceNumber: input.referenceNumber,
    machineName: input.machineName,
    machineModel: input.machineModel,
    quantity: input.quantity,
    specifications: input.specifications,
    specialInstructions: input.specialInstructions,
    unitPrice: input.unitPrice,
    totalValue: input.totalValue,
    tax: input.tax,
    currency: input.currency,
    expectedCompletionDate: d(input.expectedCompletionDate),
  };
}

export async function upsertCustomerFromInput(tx: Tx, c: CustomerInput, actor: Actor) {
  const existing = await tx.customer.findFirst({ where: { name: { equals: c.name, mode: "insensitive" } } });
  if (existing) return existing;
  const customer = await tx.customer.create({ data: { ...c, emailDomain: emailDomain(c.email) } });
  await audit(tx, actor, {
    action: AUDIT.CUSTOMER_UPDATED,
    summary: `${actor.name} created customer ${customer.name}`,
    entityType: "customer",
    entityId: customer.id,
    newValue: c,
  });
  return customer;
}

/** undefined = leave the order's customer unchanged. */
async function resolveCustomerId(tx: Tx, input: OrderInput, actor: Actor): Promise<string | undefined> {
  if (input.customerId) {
    const c = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!c) throw new AppError("Selected customer does not exist.", "VALIDATION");
    return c.id;
  }
  if (input.newCustomer?.name) return (await upsertCustomerFromInput(tx, input.newCustomer, actor)).id;
  return undefined;
}

/** Create/refresh stage-progress rows for every active stage. */
export async function ensureStageRows(tx: Tx, orderId: string) {
  const stages = await tx.assemblyStage.findMany({ where: { active: true } });
  await tx.orderStageProgress.createMany({
    data: stages.map((s) => ({ orderId, stageId: s.id })),
    skipDuplicates: true,
  });
}

export function missingForApproval(o: Pick<Order, "customerId" | "poNumber" | "machineName" | "quantity">): string[] {
  const missing: string[] = [];
  if (!o.customerId) missing.push("customer");
  if (!o.poNumber) missing.push("PO number");
  if (!o.machineName) missing.push("machine / product");
  if (!o.quantity || o.quantity < 1) missing.push("quantity");
  return missing;
}

// --------------------------------------------------------------- operations

export class DuplicateWarning extends AppError {
  constructor(public readonly candidates: DuplicateCandidate[]) {
    super("Possible duplicate PO detected.", "CONFLICT", candidates);
  }
}

/** Admin creates an order manually (PO received by other means). Goes straight to ORDER_CREATED. */
export async function createManualOrder(raw: unknown, actor: Actor, opts: { allowDuplicate?: boolean } = {}) {
  assertAdmin(actor);
  const input = orderInputSchema.parse(raw);
  if (!input.customerId && !input.newCustomer?.name) throw new AppError("Select an existing customer or enter a new customer.", "VALIDATION");
  if (!input.machineName) throw new AppError("Machine / product is required.", "VALIDATION");
  if (!input.quantity) throw new AppError("Quantity is required.", "VALIDATION");

  if (!opts.allowDuplicate && input.poNumber) {
    const candidates = await findDuplicateCandidates({
      poNumber: input.poNumber,
      customerId: input.customerId,
      customerName: input.newCustomer?.name,
      poDate: input.poDate,
    });
    if (candidates.length) throw new DuplicateWarning(candidates);
  }

  return prisma.$transaction(async (tx) => {
    const customerId = await resolveCustomerId(tx, input, actor);
    const orderNumber = await nextOrderNumber(tx);
    const order = await tx.order.create({
      data: {
        ...orderData(input),
        customerId,
        orderNumber,
        source: "MANUAL",
        status: "ORDER_CREATED",
        approvedAt: new Date(),
      },
      include: { customer: true },
    });
    await tx.purchaseOrder.create({
      data: { orderId: order.id, source: "MANUAL", extractionStatus: "MANUAL", duplicateStatus: opts.allowDuplicate ? "OVERRIDDEN" : "NONE" },
    });
    await ensureStageRows(tx, order.id);
    await audit(tx, actor, {
      action: AUDIT.ORDER_CREATED,
      summary: `${actor.name} created order ${orderNumber} manually for ${order.customer?.name ?? "—"}${opts.allowDuplicate ? " (duplicate warning overridden)" : ""}`,
      orderId: order.id,
      entityType: "order",
      entityId: order.id,
      newValue: { orderNumber, ...input },
    });
    return order;
  });
}

/** Admin edits order / PO data. Editing an imported PO moves it into review. */
export async function updateOrder(orderId: string, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = orderInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const before = await tx.order.findUnique({ where: { id: orderId } });
    if (!before) throw new AppError("Order not found.", "NOT_FOUND");
    if (!canPerform("EDIT", "ADMIN", before.status)) {
      throw new AppError(`A ${statusLabel(before.status)} order can no longer be edited.`, "INVALID_TRANSITION");
    }
    const customerId = await resolveCustomerId(tx, input, actor);
    const data = { ...orderData(input), customerId };
    const d = diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
    const status: OrderStatus = before.status === "PO_RECEIVED" ? "PO_UNDER_REVIEW" : before.status;
    const updated = await tx.order.update({ where: { id: orderId }, data: { ...data, status } });
    if (d.changed.length) {
      await audit(tx, actor, {
        action: AUDIT.ORDER_EDITED,
        summary: `${actor.name} edited ${d.changed.join(", ")}`,
        orderId,
        entityType: "order",
        entityId: orderId,
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    if (status !== before.status) {
      await audit(tx, actor, {
        action: AUDIT.PO_REVIEW_STARTED,
        summary: `${actor.name} started reviewing the imported PO`,
        orderId,
        oldValue: { status: before.status },
        newValue: { status },
      });
    }
    return updated;
  });
}

export async function startReview(orderId: string, actor: Actor) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const o = await transition(tx, orderId, "START_REVIEW", actor, "PO_UNDER_REVIEW");
    await audit(tx, actor, { action: AUDIT.PO_REVIEW_STARTED, summary: `${actor.name} started reviewing the imported PO`, orderId });
    return o;
  });
}

/** Approve a reviewed PO: validates key data, blocks unresolved duplicates, assigns ORD-YYYY-NNNN. */
export async function approveOrder(orderId: string, actor: Actor) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const current = await tx.order.findUnique({ where: { id: orderId }, include: { purchaseOrders: true, customer: true } });
    if (!current) throw new AppError("Order not found.", "NOT_FOUND");
    if (current.purchaseOrders.some((p) => p.duplicateStatus === "SUSPECTED")) {
      throw new AppError("Possible duplicate PO detected. Merge, ignore or choose “Create anyway” before approving.", "CONFLICT");
    }
    const missing = missingForApproval(current);
    if (missing.length) throw new AppError(`Cannot approve: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. Edit the order first.`, "VALIDATION");
    const orderNumber = current.orderNumber ?? (await nextOrderNumber(tx));
    const order = await transition(tx, orderId, "APPROVE", actor, "ORDER_CREATED", { orderNumber, approvedAt: new Date() });
    await ensureStageRows(tx, orderId);
    await audit(tx, actor, {
      action: AUDIT.ORDER_APPROVED,
      summary: `${actor.name} approved the PO — order ${orderNumber} created`,
      orderId,
      entityType: "order",
      entityId: orderId,
      newValue: { orderNumber },
    });
    return order;
  });
}

/** Assign (or reassign) an engineer. Shows up on the engineer's dashboard; engineer is notified. */
export async function assignEngineer(orderId: string, engineerId: string, actor: Actor, opts: { expectedCompletionDate?: string | null } = {}) {
  assertAdmin(actor);
  const engineer = await prisma.user.findUnique({ where: { id: engineerId } });
  if (!engineer || engineer.role !== "ENGINEER" || !engineer.active) throw new AppError("Select an active engineer.", "VALIDATION");

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: orderId }, include: { engineer: true, customer: true } });
    if (!before) throw new AppError("Order not found.", "NOT_FOUND");
    if (before.engineerId === engineerId && before.status !== "ORDER_CREATED") {
      throw new AppError(`${engineer.name} is already assigned to this order.`, "VALIDATION");
    }
    const action: WorkflowAction = before.status === "ORDER_CREATED" ? "ASSIGN" : "REASSIGN";
    const expected = opts.expectedCompletionDate ? dateOnly(opts.expectedCompletionDate) : undefined;
    const order = await transition(tx, orderId, action, actor, "ASSIGNED", {
      engineerId,
      assignedAt: new Date(),
      acceptedAt: null,
      ...(expected ? { expectedCompletionDate: expected } : {}),
    });
    await audit(tx, actor, {
      action: action === "ASSIGN" ? AUDIT.ENGINEER_ASSIGNED : AUDIT.ENGINEER_REASSIGNED,
      summary:
        action === "ASSIGN"
          ? `${actor.name} assigned ${engineer.name}`
          : `${actor.name} reassigned the order from ${before.engineer?.name ?? "—"} to ${engineer.name}`,
      orderId,
      entityType: "order",
      entityId: orderId,
      oldValue: { engineer: before.engineer?.name ?? null, expectedCompletionDate: before.expectedCompletionDate },
      newValue: { engineer: engineer.name, expectedCompletionDate: expected ?? before.expectedCompletionDate },
    });
    const ref = { id: orderId, orderNumber: order.orderNumber, customerName: before.customer?.name, machineName: order.machineName };
    await notifyUserInApp(
      engineerId,
      {
        type: "ORDER_ASSIGNED",
        title: `New order assigned: ${orderRef(ref)}`,
        message: `${before.customer?.name ?? ""} — ${order.machineName ?? ""}. Please review and accept.`,
        link: `/orders/${orderId}`,
        orderId,
      },
      tx,
    );
    if (before.engineerId && before.engineerId !== engineerId) {
      await notifyUserInApp(before.engineerId, { type: "ORDER_UNASSIGNED", title: `${orderRef(ref)} was reassigned`, message: `The order has been reassigned to another engineer.`, orderId }, tx);
    }
    const prefs = await getSetting("whatsapp");
    const ids: (string | null)[] = [];
    if (prefs.notifyEngineerOnAssignment && engineer.phone) {
      ids.push(
        await queueWhatsApp(tx, {
          event: "ORDER_ASSIGNED",
          orderId,
          to: engineer.phone,
          recipientLabel: engineer.name,
          message: messages.assignedToEngineer(ref, engineer.name, order.expectedCompletionDate),
        }),
      );
    }
    return { order, notificationIds: ids };
  });
  await deliverNotifications(result.notificationIds);
  return result.order;
}

/** Engineer accepts an assigned order → admin is notified on WhatsApp. */
export async function acceptOrder(orderId: string, actor: Actor) {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!before) throw new AppError("Order not found.", "NOT_FOUND");
    assertAssignedEngineer(actor, before);
    const order = await transition(tx, orderId, "ACCEPT", actor, "ACCEPTED", { acceptedAt: new Date(), lastUpdateAt: new Date() });
    await ensureStageRows(tx, orderId);
    await audit(tx, actor, { action: AUDIT.ENGINEER_ACCEPTED, summary: `${actor.name} accepted the order`, orderId, entityType: "order", entityId: orderId });
    const ref = { id: orderId, orderNumber: order.orderNumber, customerName: before.customer?.name, machineName: order.machineName };
    await notifyAdminsInApp({ type: "ORDER_ACCEPTED", title: `${orderRef(ref)} accepted`, message: messages.accepted(ref, actor.name), link: `/orders/${orderId}`, orderId }, tx);
    const id = await queueWhatsApp(tx, { event: "ORDER_ACCEPTED", orderId, message: messages.accepted(ref, actor.name) });
    return { order, ids: [id] };
  });
  await deliverNotifications(result.ids);
  return result.order;
}

export async function holdOrder(orderId: string, reason: string, actor: Actor) {
  assertAdmin(actor);
  if (!reason.trim()) throw new AppError("Enter a reason for putting the order on hold.", "VALIDATION");
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const o = await transition(tx, orderId, "HOLD", actor, "ON_HOLD", { statusBeforeHold: before.status, holdReason: reason.trim() });
    await audit(tx, actor, { action: AUDIT.ON_HOLD, summary: `${actor.name} put the order on hold: ${reason.trim()}`, orderId });
    if (o.engineerId) await notifyUserInApp(o.engineerId, { type: "ORDER_ON_HOLD", title: `${o.orderNumber} is on hold`, message: reason.trim(), link: `/orders/${orderId}`, orderId }, tx);
    return o;
  });
}

export async function resumeOrder(orderId: string, actor: Actor) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const to = before.statusBeforeHold ?? "ORDER_CREATED";
    const o = await transition(tx, orderId, "RESUME", actor, to, { statusBeforeHold: null, holdReason: null });
    await audit(tx, actor, { action: AUDIT.RESUMED, summary: `${actor.name} resumed the order (${statusLabel(to)})`, orderId });
    if (o.engineerId) await notifyUserInApp(o.engineerId, { type: "ORDER_RESUMED", title: `${o.orderNumber} resumed`, message: "Work on the order can continue.", link: `/orders/${orderId}`, orderId }, tx);
    return o;
  });
}

export async function cancelOrder(orderId: string, reason: string, actor: Actor, db?: Tx) {
  assertAdmin(actor);
  if (!reason.trim()) throw new AppError("Enter a reason for cancelling.", "VALIDATION");
  const run = async (tx: Tx) => {
    const o = await transition(tx, orderId, "CANCEL", actor, "CANCELLED", { cancelReason: reason.trim() });
    await audit(tx, actor, { action: AUDIT.CANCELLED, summary: `${actor.name} cancelled the order: ${reason.trim()}`, orderId });
    if (o.engineerId) await notifyUserInApp(o.engineerId, { type: "ORDER_CANCELLED", title: `${o.orderNumber ?? "Order"} cancelled`, message: reason.trim(), orderId }, tx);
    return o;
  };
  return db ? run(db) : prisma.$transaction(run);
}

export async function addOrderNote(orderId: string, body: string, actor: Actor) {
  assertAdmin(actor);
  const text = body.trim();
  if (!text) throw new AppError("Note cannot be empty.", "VALIDATION");
  if (text.length > 2000) throw new AppError("Note is too long (max 2000 characters).", "VALIDATION");
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError("Order not found.", "NOT_FOUND");
    const note = await tx.orderNote.create({ data: { orderId, authorId: actor.id!, body: text } });
    await audit(tx, actor, { action: AUDIT.NOTE_ADDED, summary: `${actor.name} added a note`, orderId, entityType: "note", entityId: note.id, newValue: { body: text } });
    return note;
  });
}

export function expectedLabel(d: Date | null) {
  return d ? formatDate(d) : "Not set";
}
