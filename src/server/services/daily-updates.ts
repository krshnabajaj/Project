import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { dailyUpdateSchema } from "@/lib/schemas";
import { canPerform, MAX_PROGRESS_PHOTOS_PER_UPDATE, workStatusForPhase } from "@/lib/workflow";
import { statusLabel } from "@/lib/status";
import { addDaysIso, dateOnly, todayIso } from "@/lib/utils";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { assertAssignedEngineer, lockOrder } from "./access";
import { transition, ensureStageRows } from "./orders";
import { deliverNotifications, notifyAdminsInApp, queueWhatsApp } from "./notifications";
import { messages, orderRef } from "./messages";
import { processImage, removeStored, storeImages, type ProcessedImage, type UploadFile } from "./images";

/**
 * Engineer's end-of-day update. Always appends a new daily_updates row (history is
 * never overwritten), moves stage tracking forward, logs every stage change, and
 * notifies the admin on WhatsApp.
 */
export async function addDailyUpdate(orderId: string, raw: unknown, actor: Actor, photos: UploadFile[] = []) {
  const input = dailyUpdateSchema.parse(raw);
  if (photos.length > MAX_PROGRESS_PHOTOS_PER_UPDATE) {
    throw new AppError(`You can attach up to ${MAX_PROGRESS_PHOTOS_PER_UPDATE} photos to a daily update.`, "LIMIT");
  }
  const today = todayIso();
  const updateDate = input.updateDate ?? today;
  if (updateDate > today) throw new AppError("Update date cannot be in the future.", "VALIDATION");
  if (updateDate < addDaysIso(today, -7)) throw new AppError("Updates can be back-dated by at most 7 days.", "VALIDATION");
  if (input.expectedCompletion && input.expectedCompletion < today) throw new AppError("Estimated completion date cannot be in the past.", "VALIDATION");

  const pre = await prisma.order.findUnique({ where: { id: orderId } });
  if (!pre) throw new AppError("Order not found.", "NOT_FOUND");
  assertAssignedEngineer(actor, pre);
  if (!canPerform("PROGRESS_UPDATE", "ENGINEER", pre.status)) {
    throw new AppError(
      pre.status === "ASSIGNED" ? "Accept the order before posting progress updates." : `Progress cannot be updated while the order is "${statusLabel(pre.status)}".`,
      "INVALID_TRANSITION",
    );
  }

  const processed: ProcessedImage[] = [];
  for (const p of photos) processed.push(await processImage(p));
  const keys = processed.length ? await storeImages(orderId, processed, "progress") : [];

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, currentStage: true } });
      assertAssignedEngineer(actor, order);
      const stage = await tx.assemblyStage.findUnique({ where: { id: input.stageId } });
      if (!stage || !stage.active) throw new AppError("Select a valid assembly stage.", "VALIDATION");
      if (stage.phase === "FINAL") throw new AppError(`Use “Mark machine completed” to move the order to "${stage.name}".`, "VALIDATION");

      await ensureStageRows(tx, orderId);
      const now = new Date();
      const stageChanged = order.currentStageId !== stage.id;

      // Earlier stages are complete once work has moved past them.
      const earlier = await tx.assemblyStage.findMany({ where: { sequence: { lt: stage.sequence } }, select: { id: true } });
      await tx.orderStageProgress.updateMany({
        where: { orderId, stageId: { in: earlier.map((s) => s.id) }, status: { not: "COMPLETED" } },
        data: { status: "COMPLETED", completedAt: now, updatedById: actor.id },
      });
      await tx.orderStageProgress.updateMany({
        where: { orderId, stageId: { in: earlier.map((s) => s.id) }, startedAt: null },
        data: { startedAt: now },
      });
      const sp = await tx.orderStageProgress.findUniqueOrThrow({ where: { orderId_stageId: { orderId, stageId: stage.id } } });
      await tx.orderStageProgress.update({
        where: { id: sp.id },
        data: {
          status: input.stageCompleted ? "COMPLETED" : sp.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
          startedAt: sp.startedAt ?? now,
          completedAt: input.stageCompleted ? now : sp.completedAt,
          notes: input.workCompleted,
          updatedById: actor.id,
        },
      });

      const update = await tx.dailyUpdate.create({
        data: {
          orderId,
          engineerId: actor.id!,
          updateDate: dateOnly(updateDate),
          stageId: stage.id,
          previousStageId: order.currentStageId,
          progress: input.progress,
          workCompleted: input.workCompleted,
          issues: input.issues,
          expectedDelayDays: input.expectedDelayDays,
          materialRequired: input.materialRequired,
          nextStep: input.nextStep,
          expectedCompletion: input.expectedCompletion ? dateOnly(input.expectedCompletion) : null,
        },
      });
      for (let i = 0; i < processed.length; i++) {
        const p = processed[i]!;
        await tx.orderImage.create({
          data: { orderId, dailyUpdateId: update.id, kind: "PROGRESS", uploadedById: actor.id!, storageKey: keys[i]!, fileName: p.fileName, mimeType: p.mimeType, size: p.size, width: p.width, height: p.height },
        });
      }

      const newStatus: OrderStatus = workStatusForPhase(stage.phase);
      const orderPatch = {
        currentStageId: stage.id,
        progressPercentage: input.progress,
        lastUpdateAt: now,
        // The engineer's estimate is adopted only if the admin never set a target date.
        ...(input.expectedCompletion && !order.expectedCompletionDate ? { expectedCompletionDate: dateOnly(input.expectedCompletion) } : {}),
      };
      if (newStatus !== order.status) await transition(tx, orderId, "PROGRESS_UPDATE", actor, newStatus, orderPatch);
      else await tx.order.update({ where: { id: orderId }, data: orderPatch });

      await audit(tx, actor, {
        action: AUDIT.DAILY_UPDATE_ADDED,
        summary: `${actor.name} added daily update — ${stage.name}, ${input.progress}%${processed.length ? `, ${processed.length} photo(s)` : ""}`,
        orderId,
        entityType: "daily_update",
        entityId: update.id,
        newValue: input,
      });
      if (stageChanged) {
        await audit(tx, actor, {
          action: AUDIT.STAGE_CHANGED,
          summary: `${actor.name} updated stage to ${stage.name}`,
          orderId,
          entityType: "order",
          entityId: orderId,
          oldValue: { stage: order.currentStage?.name ?? null, progress: order.progressPercentage },
          newValue: { stage: stage.name, progress: input.progress },
        });
      }
      if (input.issues) {
        await audit(tx, actor, { action: AUDIT.ISSUE_REPORTED, summary: `${actor.name} reported an issue: ${input.issues}`, orderId, entityType: "daily_update", entityId: update.id });
      }

      const ref = { id: orderId, orderNumber: order.orderNumber, customerName: order.customer?.name, machineName: order.machineName };
      const ids: (string | null)[] = [];
      ids.push(
        await queueWhatsApp(tx, {
          event: "DAILY_UPDATE",
          orderId,
          message: messages.dailyUpdate(ref, actor.name, stage.name, input.progress, input.workCompleted, stageChanged),
        }),
      );
      await notifyAdminsInApp(
        { type: "DAILY_UPDATE", title: `${orderRef(ref)}: ${stage.name} — ${input.progress}%`, message: `${actor.name}: ${input.workCompleted}`, link: `/orders/${orderId}`, orderId },
        tx,
      );
      if (input.issues) {
        ids.push(await queueWhatsApp(tx, { event: "ISSUE_REPORTED", orderId, message: messages.issue(ref, actor.name, input.issues, input.expectedDelayDays) }));
        await notifyAdminsInApp(
          { type: "ISSUE_REPORTED", title: `⚠️ Issue on ${orderRef(ref)}`, message: `${actor.name}: ${input.issues}`, link: `/orders/${orderId}`, orderId },
          tx,
        );
      }
      return { update, ids };
    });
    await deliverNotifications(result.ids);
    return result.update;
  } catch (err) {
    await removeStored(keys);
    throw err;
  }
}
