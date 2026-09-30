import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { canPerform } from "@/lib/workflow";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { assertAdmin, assertAssignedEngineer } from "./access";
import { transition, ensureStageRows } from "./orders";
import { deliverNotifications, notifyAdminsInApp, queueEmail, queueWhatsApp } from "./notifications";
import { messages, orderRef } from "./messages";
import { completionEmailRecipients } from "../settings";
import { completionSubject } from "./completion-email";

/** Engineer marks the machine completed: all stages complete, progress 100%. */
export async function markMachineCompleted(orderId: string, remarks: string | null, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!before) throw new AppError("Order not found.", "NOT_FOUND");
    assertAssignedEngineer(actor, before);
    await ensureStageRows(tx, orderId);
    const now = new Date();
    const finalStage = await tx.assemblyStage.findFirst({ where: { active: true, phase: "FINAL" }, orderBy: { sequence: "desc" } });
    await tx.orderStageProgress.updateMany({ where: { orderId, startedAt: null }, data: { startedAt: now } });
    await tx.orderStageProgress.updateMany({
      where: { orderId, status: { not: "COMPLETED" } },
      data: { status: "COMPLETED", completedAt: now, updatedById: actor.id },
    });
    const order = await transition(tx, orderId, "MARK_COMPLETED", actor, "COMPLETED", {
      completedAt: now,
      completionRemarks: remarks?.trim() || null,
      progressPercentage: 100,
      currentStageId: finalStage?.id ?? before.currentStageId,
      lastUpdateAt: now,
    });
    await audit(tx, actor, {
      action: AUDIT.MACHINE_COMPLETED,
      summary: `${actor.name} marked the machine completed${remarks ? `: ${remarks.trim()}` : ""}`,
      orderId,
      entityType: "order",
      entityId: orderId,
    });
    if (finalStage && before.currentStageId !== finalStage.id) {
      await audit(tx, actor, { action: AUDIT.STAGE_CHANGED, summary: `${actor.name} updated stage to ${finalStage.name}`, orderId });
    }
    const ref = { id: orderId, orderNumber: order.orderNumber, customerName: before.customer?.name };
    await notifyAdminsInApp(
      { type: "MACHINE_COMPLETED", title: `${orderRef(ref)} machine completed`, message: `${actor.name} marked the machine completed. Awaiting photographs.`, link: `/orders/${orderId}`, orderId },
      tx,
    );
    return order;
  });
}

/**
 * Engineer submits the completion photographs. Locks the gallery, notifies the
 * admin on WhatsApp and emails the completion summary with the photographs.
 */
export async function submitCompletionPhotos(orderId: string, actor: Actor) {
  const { to, cc } = await completionEmailRecipients();
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!before) throw new AppError("Order not found.", "NOT_FOUND");
    assertAssignedEngineer(actor, before);
    const photoCount = await tx.orderImage.count({ where: { orderId, kind: "MACHINE" } });
    if (photoCount === 0) throw new AppError("Upload at least one machine photograph before submitting.", "VALIDATION");
    const order = await transition(tx, orderId, "SUBMIT_PHOTOS", actor, "PHOTOS_UPLOADED", { photosSubmittedAt: new Date() });
    await audit(tx, actor, {
      action: AUDIT.PHOTOS_SUBMITTED,
      summary: `${actor.name} submitted ${photoCount} completion photograph${photoCount === 1 ? "" : "s"}`,
      orderId,
      newValue: { photoCount },
    });
    const ref = { id: orderId, orderNumber: order.orderNumber, customerName: before.customer?.name };
    const ids: (string | null)[] = [];
    ids.push(await queueWhatsApp(tx, { event: "MACHINE_COMPLETED", orderId, message: messages.completed(ref, actor.name, photoCount) }));
    ids.push(
      await queueEmail(tx, {
        type: "COMPLETION_EMAIL",
        orderId,
        to,
        cc,
        subject: completionSubject(order.orderNumber, before.customer?.name ?? null),
        text: messages.completed(ref, actor.name, photoCount),
      }),
    );
    await notifyAdminsInApp(
      { type: "PHOTOS_UPLOADED", title: `${orderRef(ref)}: ${photoCount} photos uploaded`, message: `Completion summary is being emailed to ${to.join(", ") || "(no recipient configured)"}.`, link: `/orders/${orderId}`, orderId },
      tx,
    );
    return { order, ids };
  });
  await deliverNotifications(result.ids);
  return result.order;
}

/** Convenience for the mobile flow: complete + submit in one tap when photos are already uploaded. */
export async function completeAndSubmit(orderId: string, remarks: string | null, actor: Actor) {
  const photos = await prisma.orderImage.count({ where: { orderId, kind: "MACHINE" } });
  if (photos === 0) throw new AppError("Upload at least one machine photograph first.", "VALIDATION");
  await markMachineCompleted(orderId, remarks, actor);
  return submitCompletionPhotos(orderId, actor);
}

/** Admin re-sends the completion summary (e.g. after fixing SMTP settings or recipients). */
export async function resendCompletionEmail(orderId: string, actor: Actor) {
  assertAdmin(actor);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order) throw new AppError("Order not found.", "NOT_FOUND");
  if (!order.photosSubmittedAt || canPerform("SUBMIT_PHOTOS", "ENGINEER", order.status)) {
    throw new AppError("The completion summary is available after the engineer submits the photographs.", "INVALID_TRANSITION");
  }
  const { to, cc } = await completionEmailRecipients();
  if (!to.length) throw new AppError("No completion email recipient configured. Set it in Settings → Email.", "VALIDATION");
  const id = await prisma.$transaction((tx) =>
    queueEmail(tx, {
      type: "COMPLETION_EMAIL",
      orderId,
      to,
      cc,
      subject: completionSubject(order.orderNumber, order.customer?.name ?? null),
      text: `Completion summary re-sent by ${actor.name}.`,
    }),
  );
  await deliverNotifications([id]);
  return id;
}
