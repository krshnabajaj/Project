import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { dateOnly, todayIso } from "@/lib/utils";
import { packingSchema, dispatchSchema } from "@/lib/schemas";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { assertAdmin } from "./access";
import { transition } from "./orders";
import { deliverNotifications, queueWhatsApp, notifyUserInApp } from "./notifications";
import { messages } from "./messages";

/** Admin: machine packed (after completion photos were submitted). */
export async function markPacked(orderId: string, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = packingSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const order = await transition(tx, orderId, "MARK_PACKED", actor, "PACKED");
    const data = {
      packedAt: now,
      packedById: actor.id,
      packedByName: input.packedByName ?? actor.name,
      packingRemarks: input.packingRemarks,
      packageCount: input.packageCount,
      packageDimensions: input.packageDimensions,
      weightKg: input.weightKg,
    };
    await tx.dispatch.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
    await audit(tx, actor, {
      action: AUDIT.PACKED,
      summary: `${actor.name} marked the machine packed${input.packageCount ? ` (${input.packageCount} package${input.packageCount === 1 ? "" : "s"})` : ""}`,
      orderId,
      newValue: data,
    });
    return order;
  });
}

/** Admin: packed → READY FOR DISPATCH. */
export async function markReadyForDispatch(orderId: string, actor: Actor) {
  assertAdmin(actor);
  const res = await prisma.$transaction(async (tx) => {
    const order = await transition(tx, orderId, "MARK_READY", actor, "READY_FOR_DISPATCH");
    await tx.dispatch.update({ where: { orderId }, data: { readyAt: new Date(), readyById: actor.id } });
    await audit(tx, actor, { action: AUDIT.READY_FOR_DISPATCH, summary: `${actor.name} marked the order READY FOR DISPATCH`, orderId });
    const customer = order.customerId ? await tx.customer.findUnique({ where: { id: order.customerId } }) : null;
    const id = await queueWhatsApp(tx, {
      event: "READY_FOR_DISPATCH",
      orderId,
      message: messages.readyForDispatch({ id: orderId, orderNumber: order.orderNumber, customerName: customer?.name }),
    });
    if (order.engineerId) {
      await notifyUserInApp(order.engineerId, { type: "READY_FOR_DISPATCH", title: `${order.orderNumber} ready for dispatch`, message: "The machine you built has been packed.", link: `/orders/${orderId}`, orderId }, tx);
    }
    return { order, ids: [id] };
  });
  await deliverNotifications(res.ids);
  return res.order;
}

/** Admin: shipped. Captures courier / transporter and AWB/LR number. */
export async function markDispatched(orderId: string, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = dispatchSchema.parse(raw);
  if (!input.transporter && !input.courier) throw new AppError("Enter the courier or transporter.", "VALIDATION");
  if (input.dispatchedAt && input.dispatchedAt > todayIso()) throw new AppError("Dispatch date cannot be in the future.", "VALIDATION");
  return prisma.$transaction(async (tx) => {
    const order = await transition(tx, orderId, "MARK_DISPATCHED", actor, "DISPATCHED");
    const data = {
      dispatchedAt: input.dispatchedAt ? dateOnly(input.dispatchedAt) : new Date(),
      dispatchedById: actor.id,
      courier: input.courier,
      transporter: input.transporter,
      trackingNumber: input.trackingNumber,
      vehicleNumber: input.vehicleNumber,
      dispatchRemarks: input.dispatchRemarks,
    };
    await tx.dispatch.update({ where: { orderId }, data });
    await audit(tx, actor, {
      action: AUDIT.DISPATCHED,
      summary: `${actor.name} marked the order DISPATCHED via ${input.courier ?? input.transporter}${input.trackingNumber ? ` (AWB/LR ${input.trackingNumber})` : ""}`,
      orderId,
      newValue: data,
    });
    return order;
  });
}

export async function closeOrder(orderId: string, actor: Actor) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const order = await transition(tx, orderId, "CLOSE", actor, "CLOSED");
    await tx.dispatch.update({ where: { orderId }, data: { closedAt: new Date() } });
    await audit(tx, actor, { action: AUDIT.CLOSED, summary: `${actor.name} closed the order`, orderId });
    return order;
  });
}
