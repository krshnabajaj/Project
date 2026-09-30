import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createManualOrder, assignEngineer, acceptOrder } from "@/server/services/orders";
import { addDailyUpdate } from "@/server/services/daily-updates";
import { uploadMachinePhotos, deleteMachinePhoto } from "@/server/services/images";
import { markMachineCompleted, submitCompletionPhotos } from "@/server/services/completion";
import { markPacked, markReadyForDispatch, markDispatched, closeOrder } from "@/server/services/dispatch";
import { retryNotification, retryFailedNotifications } from "@/server/services/notifications";
import { runOverdueCheck } from "@/server/services/overdue";
import { setSetting } from "@/server/settings";
import { setWhatsAppProvider } from "@/server/integrations/whatsapp";
import { addDaysIso, todayIso } from "@/lib/utils";
import { seedBase, type Base, useRecordingWhatsApp, type RecordingWhatsApp, photoFiles } from "./helpers";

let b: Base;
let wa: RecordingWhatsApp;
beforeEach(async () => {
  b = await seedBase();
  wa = useRecordingWhatsApp();
});

async function acceptedOrder(expected = "2099-01-01") {
  const o = await createManualOrder({ customerId: b.customer.id, poNumber: `P-${Math.random()}`, machineName: "Washer Disinfector", quantity: "1", expectedCompletionDate: expected }, b.admin);
  await assignEngineer(o.id, b.rahul.id!, b.admin);
  await acceptOrder(o.id, b.rahul);
  return o;
}

const update = (stage: string, progress: number, extra: Record<string, unknown> = {}) => ({ stageId: b.stage(stage).id, progress: String(progress), workCompleted: `Worked on ${stage}`, ...extra });

describe("stage transitions & daily updates", () => {
  it("cannot post updates before accepting", async () => {
    const o = await createManualOrder({ customerId: b.customer.id, poNumber: "Z", machineName: "M", quantity: "1" }, b.admin);
    await assignEngineer(o.id, b.rahul.id!, b.admin);
    await expect(addDailyUpdate(o.id, update("Material Issued", 5), b.rahul)).rejects.toThrow(/Accept the order/);
  });

  it("moves stages forward, completes earlier stages and logs every stage change", async () => {
    const o = await acceptedOrder();
    await addDailyUpdate(o.id, update("Mechanical Assembly", 35), b.rahul);
    let fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(fresh).toMatchObject({ status: "ASSEMBLY_IN_PROGRESS", progressPercentage: 35, currentStageId: b.stage("Mechanical Assembly").id });
    const mat = await prisma.orderStageProgress.findUniqueOrThrow({ where: { orderId_stageId: { orderId: o.id, stageId: b.stage("Material Issued").id } } });
    expect(mat.status).toBe("COMPLETED");

    await addDailyUpdate(o.id, update("Testing", 85), b.rahul);
    fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(fresh.status).toBe("TESTING");
    expect(await prisma.auditLog.count({ where: { orderId: o.id, action: "STAGE_CHANGED" } })).toBe(2);
  });

  it("preserves every daily update — history cannot be overwritten or deleted (DB-enforced)", async () => {
    const o = await acceptedOrder();
    const u1 = await addDailyUpdate(o.id, update("Mechanical Assembly", 30), b.rahul);
    await addDailyUpdate(o.id, update("Mechanical Assembly", 35), b.rahul);
    expect(await prisma.dailyUpdate.count({ where: { orderId: o.id } })).toBe(2);
    await expect(prisma.dailyUpdate.update({ where: { id: u1.id }, data: { workCompleted: "rewritten" } })).rejects.toThrow(/append-only/);
    await expect(prisma.dailyUpdate.delete({ where: { id: u1.id } })).rejects.toThrow(/append-only/);
    const a = await prisma.auditLog.findFirstOrThrow({ where: { orderId: o.id } });
    await expect(prisma.auditLog.update({ where: { id: a.id }, data: { summary: "x" } })).rejects.toThrow(/append-only/);
  });

  it("validates progress range and dates", async () => {
    const o = await acceptedOrder();
    await expect(addDailyUpdate(o.id, update("Mechanical Assembly", 120), b.rahul)).rejects.toThrow();
    await expect(addDailyUpdate(o.id, update("Mechanical Assembly", 20, { updateDate: addDaysIso(todayIso(), 1) }), b.rahul)).rejects.toThrow(/future/);
    await expect(addDailyUpdate(o.id, update("Machine Completed", 100), b.rahul)).rejects.toThrow(/Mark machine completed/);
  });
});

describe("WhatsApp notification generation", () => {
  it("notifies admin on accept, on each update, and separately for issues", async () => {
    const o = await acceptedOrder();
    expect(wa.sent.some((m) => m.to === "+919800000001" && /has been accepted by Rahul/.test(m.body))).toBe(true);
    wa.sent = [];
    await addDailyUpdate(o.id, update("Electrical Assembly", 55, { workCompleted: "Control panel wiring completed.", issues: "Waiting for PLC module", expectedDelayDays: "2" }), b.rahul);
    expect(wa.sent).toHaveLength(2);
    expect(wa.sent[0]!.body).toContain("Stage updated: Electrical Assembly");
    expect(wa.sent[0]!.body).toContain("Progress: 55%");
    expect(wa.sent[1]!.body).toMatch(/⚠️ .*\nEngineer: Rahul\nIssue: Waiting for PLC module\nExpected delay: 2 days\./);
    expect(await prisma.notification.count({ where: { orderId: o.id, channel: "WHATSAPP", status: "SENT" } })).toBe(4); // engineer assignment + accept + update + issue
    expect(await prisma.auditLog.count({ where: { orderId: o.id, action: "WHATSAPP_SENT" } })).toBe(4);
  });

  it("respects admin-disabled notification types", async () => {
    await setSetting("whatsapp", { adminNumber: "+919800000001", enabledTypes: ["ORDER_ACCEPTED"] }, b.admin);
    const o = await acceptedOrder();
    wa.sent = [];
    await addDailyUpdate(o.id, update("Mechanical Assembly", 20), b.rahul);
    expect(wa.sent).toHaveLength(0);
  });

  it("records failures visibly, alerts admin, and can be retried", async () => {
    const o = await acceptedOrder();
    wa.failNext = true;
    await addDailyUpdate(o.id, update("Mechanical Assembly", 20), b.rahul);
    const n = await prisma.notification.findFirstOrThrow({ where: { orderId: o.id, type: "DAILY_UPDATE" } });
    expect(n.status).toBe("FAILED");
    expect(n.error).toContain("Simulated provider outage");
    expect(await prisma.inAppNotification.count({ where: { type: "WHATSAPP_FAILED" } })).toBeGreaterThan(0);
    expect(await prisma.systemLog.count({ where: { level: "ERROR", source: "whatsapp" } })).toBe(1);
    expect(await retryNotification(n.id, b.admin)).toBe("SENT");
  });

  it("background retry re-sends failed messages after backoff", async () => {
    const o = await acceptedOrder();
    wa.failNext = true;
    await addDailyUpdate(o.id, update("Mechanical Assembly", 20), b.rahul);
    const res = await retryFailedNotifications(new Date(Date.now() + 10 * 60_000));
    expect(res.delivered).toBe(1);
  });

  it("marks messages SKIPPED (not silently dropped) when WhatsApp is not configured", async () => {
    setWhatsAppProvider(null);
    const o = await acceptedOrder();
    const n = await prisma.notification.findFirstOrThrow({ where: { orderId: o.id, type: "ORDER_ACCEPTED" } });
    expect(n.status).toBe("SKIPPED");
    expect(n.error).toMatch(/not sent/);
  });
});

describe("machine photographs", () => {
  it("enforces the 8-photo limit, including across multiple uploads", async () => {
    const o = await acceptedOrder();
    await addDailyUpdate(o.id, update("Testing", 85), b.rahul);
    await expect(uploadMachinePhotos(o.id, await photoFiles(9), b.rahul)).rejects.toThrow(/Maximum 8/);
    await uploadMachinePhotos(o.id, await photoFiles(6), b.rahul);
    await expect(uploadMachinePhotos(o.id, await photoFiles(3), b.rahul)).rejects.toThrow(/you can add 2 more/);
    await uploadMachinePhotos(o.id, await photoFiles(2), b.rahul);
    expect(await prisma.orderImage.count({ where: { orderId: o.id, kind: "MACHINE" } })).toBe(8);
  });

  it("rejects non-image and wrong-type files, compresses and strips metadata", async () => {
    const o = await acceptedOrder();
    await expect(uploadMachinePhotos(o.id, [{ name: "a.jpg", type: "image/jpeg", buffer: Buffer.from("not an image") }], b.rahul)).rejects.toThrow(/not a valid image/);
    await expect(uploadMachinePhotos(o.id, [{ name: "a.gif", type: "image/gif", buffer: Buffer.from("GIF89a") }], b.rahul)).rejects.toThrow(/JPG, JPEG and PNG/);
    const [img] = await uploadMachinePhotos(o.id, await photoFiles(1), b.rahul);
    expect(img!.mimeType).toBe("image/jpeg");
    expect(img!.width).toBe(800);
  });

  it("only the assigned engineer can upload; photos are locked after submission", async () => {
    const o = await acceptedOrder();
    await addDailyUpdate(o.id, update("Testing", 85), b.rahul);
    await expect(uploadMachinePhotos(o.id, await photoFiles(1), b.priya)).rejects.toThrow(/assigned/);
    const [img] = await uploadMachinePhotos(o.id, await photoFiles(1), b.rahul);
    await markMachineCompleted(o.id, "done", b.rahul);
    await submitCompletionPhotos(o.id, b.rahul);
    await expect(deleteMachinePhoto(img!.id, b.rahul)).rejects.toThrow(/after they have been submitted/);
    await expect(uploadMachinePhotos(o.id, await photoFiles(1), b.rahul)).rejects.toThrow();
  });
});

describe("dispatch workflow", () => {
  it("enforces completed → photos → packed → ready → dispatched → closed", async () => {
    const o = await acceptedOrder();
    await addDailyUpdate(o.id, update("Final Inspection", 95), b.rahul);
    await expect(markPacked(o.id, {}, b.admin)).rejects.toThrow(/Cannot mark as packed/);
    await markMachineCompleted(o.id, null, b.rahul);
    await expect(submitCompletionPhotos(o.id, b.rahul)).rejects.toThrow(/at least one/);
    await uploadMachinePhotos(o.id, await photoFiles(2), b.rahul);
    await submitCompletionPhotos(o.id, b.rahul);
    await expect(markReadyForDispatch(o.id, b.admin)).rejects.toThrow(/Cannot mark ready/);
    await markPacked(o.id, { packageCount: "2", packingRemarks: "Crated", weightKg: "640.5" }, b.admin);
    await markReadyForDispatch(o.id, b.admin);
    await expect(markDispatched(o.id, { dispatchedAt: todayIso() }, b.admin)).rejects.toThrow(/courier or transporter/);
    await markDispatched(o.id, { dispatchedAt: todayIso(), transporter: "VRL Logistics", trackingNumber: "LR-1" }, b.admin);
    await closeOrder(o.id, b.admin);
    const d = await prisma.dispatch.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(d).toMatchObject({ packageCount: 2, transporter: "VRL Logistics", trackingNumber: "LR-1", packedByName: "Admin" });
    expect(Number(d.weightKg)).toBe(640.5);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CLOSED");
  });
});

describe("overdue orders", () => {
  it("alerts admin once, then not again the same day", async () => {
    const o = await acceptedOrder(addDaysIso(todayIso(), -2));
    wa.sent = [];
    const r1 = await runOverdueCheck();
    expect(r1).toMatchObject({ overdue: 1, alerted: 1 });
    expect(wa.sent[0]!.body).toMatch(/OVERDUE/);
    expect((await runOverdueCheck()).alerted).toBe(0);
    expect(await prisma.inAppNotification.count({ where: { orderId: o.id, type: "ORDER_OVERDUE" } })).toBe(1);
  });
});
