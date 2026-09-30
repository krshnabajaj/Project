import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncGmail, processGmailMessage } from "@/server/integrations/gmail/sync";
import { parseGmailMessage, type GmailApi, type GmailMessage } from "@/server/integrations/gmail/client";
import { settingSchemas } from "@/server/settings";
import { updateOrder, approveOrder, assignEngineer, acceptOrder } from "@/server/services/orders";
import { addDailyUpdate } from "@/server/services/daily-updates";
import { uploadMachinePhotos } from "@/server/services/images";
import { completeAndSubmit, resendCompletionEmail } from "@/server/services/completion";
import { markPacked, markReadyForDispatch, markDispatched } from "@/server/services/dispatch";
import { adminDashboard, listOrders } from "@/server/services/queries";
import { todayIso } from "@/lib/utils";
import { seedBase, type Base, useRecordingWhatsApp, type RecordingWhatsApp, photoFiles, poPdf, SAMPLE_PO_LINES, startSmtp } from "./helpers";

/** In-memory Gmail mailbox implementing the same interface as the Google client. */
class FakeGmail implements GmailApi {
  messages = new Map<string, { msg: GmailMessage; files: Record<string, Buffer> }>();
  queries: string[] = [];
  add(id: string, subject: string, from: string, files: Record<string, Buffer>, body = "Please find our PO attached.") {
    this.messages.set(id, {
      msg: {
        id,
        threadId: `t-${id}`,
        from,
        subject,
        date: new Date(),
        bodyText: body,
        labelIds: ["INBOX"],
        attachments: Object.entries(files).map(([filename, buf], i) => ({ attachmentId: `a${i}`, filename, mimeType: filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", size: buf.length })),
      },
      files,
    });
  }
  async listMessageIds(query: string) {
    this.queries.push(query);
    return [...this.messages.keys()].map((id) => ({ id, threadId: `t-${id}` }));
  }
  async getMessage(id: string) {
    return this.messages.get(id)!.msg;
  }
  async getAttachment(messageId: string, attachmentId: string) {
    const m = this.messages.get(messageId)!;
    const att = m.msg.attachments.find((a) => a.attachmentId === attachmentId)!;
    return m.files[att.filename]!;
  }
}

let b: Base;
let wa: RecordingWhatsApp;
let smtp: Awaited<ReturnType<typeof startSmtp>>;
beforeAll(async () => {
  smtp = await startSmtp();
});
afterAll(async () => smtp.close());
beforeEach(async () => {
  b = await seedBase();
  wa = useRecordingWhatsApp();
  smtp.mails.length = 0;
});

describe("Gmail integration", () => {
  it("parses Gmail API payloads (headers, text body, nested attachments)", () => {
    const m = parseGmailMessage({
      id: "g1",
      threadId: "t1",
      internalDate: "1790000000000",
      payload: {
        headers: [
          { name: "From", value: "ABC Hospital <purchase@abchospital.com>" },
          { name: "Subject", value: "Purchase Order PO-4587" },
        ],
        parts: [
          { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("PO attached").toString("base64url") } }] },
          { mimeType: "application/pdf", filename: "PO-4587.pdf", body: { attachmentId: "att1", size: 1234 } },
        ],
      },
    });
    expect(m).toMatchObject({ id: "g1", from: "ABC Hospital <purchase@abchospital.com>", subject: "Purchase Order PO-4587", bodyText: "PO attached" });
    expect(m.attachments).toEqual([{ attachmentId: "att1", filename: "PO-4587.pdf", mimeType: "application/pdf", size: 1234 }]);
  });

  it("imports each message exactly once, stores the attachment and notifies admin", async () => {
    const gmail = new FakeGmail();
    gmail.add("m1", "Purchase Order PO-4587", "ABC Hospital <purchase@abchospital.com>", { "PO-4587.pdf": await poPdf(SAMPLE_PO_LINES) });
    const r1 = await syncGmail({ api: gmail });
    const r2 = await syncGmail({ api: gmail });
    expect(r1).toMatchObject({ checked: 1, imported: 1 });
    expect(r2).toMatchObject({ checked: 0, imported: 0 });
    expect(gmail.queries[0]).toContain("subject:(");

    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { gmailMessageId: "m1" }, include: { order: true, documents: true } });
    expect(po.order).toMatchObject({ status: "PO_RECEIVED", poNumber: "PO-4587", customerId: b.customer.id, quantity: 2, orderNumber: null });
    expect(po.documents).toHaveLength(1);
    expect(po.documents[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await prisma.gmailProcessedMessage.count()).toBe(1);
    expect(wa.sent[0]!.body).toContain("PO requires review");
    expect(await prisma.inAppNotification.count({ where: { type: "PO_RECEIVED" } })).toBe(1);
  });

  it("skips emails without an allowed attachment when the rule requires one", async () => {
    const gmail = new FakeGmail();
    gmail.add("m2", "PO question", "x@y.com", {});
    const rules = settingSchemas.gmail.parse({ requireAttachment: true });
    expect(await processGmailMessage(gmail, (await gmail.getMessage("m2"))!, rules)).toBe("SKIPPED");
    expect(await prisma.order.count()).toBe(0);
  });

  it("a failing message is logged, surfaced to admin, and does not block others", async () => {
    const gmail = new FakeGmail();
    gmail.add("bad", "Purchase Order 1", "a@b.com", { "po.pdf": await poPdf(SAMPLE_PO_LINES) });
    gmail.add("good", "Purchase Order 2", "a@b.com", { "po2.pdf": await poPdf(["PO No: 77", "Item: Washer", "Qty: 1"]) });
    const orig = gmail.getAttachment.bind(gmail);
    gmail.getAttachment = async (id, att) => {
      if (id === "bad") throw new Error("attachment download failed");
      return orig(id, att);
    };
    const r = await syncGmail({ api: gmail });
    expect(r).toMatchObject({ imported: 1, errors: 1 });
    expect((await prisma.gmailProcessedMessage.findUniqueOrThrow({ where: { messageId: "bad" } })).result).toBe("ERROR");
    expect(await prisma.inAppNotification.count({ where: { type: "PO_IMPORT_FAILED" } })).toBe(1);
  });
});

describe("complete happy path (acceptance test)", () => {
  it("Gmail PO → review → ORD number → assign Rahul → accept → updates → complete + 6 photos → email → packed → ready → dispatched", async () => {
    // Steps 1-4: PO email arrives and is detected + extracted
    const gmail = new FakeGmail();
    gmail.add("po-email", "Purchase Order PO-4587", "Dr. Meera Shah <purchase@abchospital.com>", { "PO-4587.pdf": await poPdf(SAMPLE_PO_LINES) });
    await syncGmail({ api: gmail });
    const draft = (await prisma.purchaseOrder.findUniqueOrThrow({ where: { gmailMessageId: "po-email" }, include: { order: true } })).order;
    expect(draft.status).toBe("PO_RECEIVED");

    // Step 5: admin reviews/corrects and approves → Step 6: ORD-YYYY-XXXX
    await updateOrder(draft.id, { customerId: b.customer.id, poNumber: "PO-4587", poDate: "2026-09-25", machineName: "Automatic Washer Disinfector", machineModel: "AWD-500", quantity: "2", expectedCompletionDate: "2099-01-01" }, b.admin);
    const approved = await approveOrder(draft.id, b.admin);
    expect(approved.orderNumber).toMatch(new RegExp(`^ORD-${todayIso().slice(0, 4)}-\\d{4}$`));

    // Step 7: assign Rahul
    await assignEngineer(draft.id, b.rahul.id!, b.admin);
    // Steps 8-10: Rahul accepts → admin WhatsApp
    wa.sent = [];
    await acceptOrder(draft.id, b.rahul);
    expect(wa.sent.map((m) => m.body)).toContain(`Order ${approved.orderNumber} has been accepted by Rahul.`);

    // Steps 11-12: Mechanical Assembly 35% → WhatsApp
    await addDailyUpdate(draft.id, { stageId: b.stage("Mechanical Assembly").id, progress: "35", workCompleted: "Frame assembled." }, b.rahul);
    expect(wa.sent.at(-1)!.body).toContain("Stage updated: Mechanical Assembly\nProgress: 35%");
    // Step 13: next day update
    await addDailyUpdate(draft.id, { stageId: b.stage("Electrical Assembly").id, progress: "55", workCompleted: "Control panel wiring completed." }, b.rahul);
    await addDailyUpdate(draft.id, { stageId: b.stage("Testing").id, progress: "85", workCompleted: "Tests passed." }, b.rahul);

    // Steps 14-17: 6 photos, mark completed → summary email with photos
    await uploadMachinePhotos(draft.id, await photoFiles(6), b.rahul);
    await completeAndSubmit(draft.id, "Machine ready for packing.", b.rahul);
    expect(wa.sent.at(-1)!.body).toBe(`${approved.orderNumber} has been marked COMPLETED by Rahul. 6 photographs uploaded. Completion summary will be emailed to Admin.`);
    expect(smtp.mails).toHaveLength(1);
    const mail = smtp.mails[0]!;
    expect(mail.to).toEqual(["admin@test.local"]);
    expect(mail.raw).toMatch(/^Subject: /m);
    expect(mail.raw).toMatch(/Machine Completed/);
    expect((mail.raw.match(/Content-Type: image\/jpeg/g) ?? []).length).toBe(6);
    expect(mail.raw).toContain(`/orders/${draft.id}`);
    const emailRow = await prisma.notification.findFirstOrThrow({ where: { orderId: draft.id, type: "COMPLETION_EMAIL" } });
    expect(emailRow.status).toBe("SENT");
    expect(emailRow.subject).toBe(`Machine Completed – ${approved.orderNumber} – ABC Hospital`);

    // Steps 18-19: packed → ready for dispatch
    await markPacked(draft.id, { packageCount: "2" }, b.admin);
    await markReadyForDispatch(draft.id, b.admin);

    // Step 20: dashboard reflects it (still visible until dispatched)
    let dash = await adminDashboard();
    expect(dash.kpis.readyForDispatch).toBe(1);
    expect((await listOrders({ status: "open" }, b.admin)).rows.some((r) => r.id === draft.id)).toBe(true);

    await markDispatched(draft.id, { dispatchedAt: todayIso(), courier: "Blue Dart", trackingNumber: "AWB123" }, b.admin);
    dash = await adminDashboard();
    expect(dash.kpis.readyForDispatch).toBe(0);
    expect(dash.pipeline.find((p) => p.key === "dispatched")!.count).toBe(1);

    // Full audit trail exists for the order
    const actions = (await prisma.auditLog.findMany({ where: { orderId: draft.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    for (const a of ["PO_IMPORTED", "ORDER_EDITED", "ORDER_APPROVED", "ENGINEER_ASSIGNED", "ENGINEER_ACCEPTED", "STAGE_CHANGED", "DAILY_UPDATE_ADDED", "PHOTO_UPLOADED", "MACHINE_COMPLETED", "PHOTOS_SUBMITTED", "EMAIL_SENT", "WHATSAPP_SENT", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED"]) {
      expect(actions, a).toContain(a);
    }
  });

  it("completion email with 8 photos; failure is visible and can be resent", async () => {
    const gmail = new FakeGmail();
    gmail.add("e2", "Purchase Order PO-4587", "purchase@abchospital.com", { "PO.pdf": await poPdf(SAMPLE_PO_LINES) });
    await syncGmail({ api: gmail });
    const o = (await prisma.order.findFirstOrThrow())!;
    await approveOrder(o.id, b.admin);
    await assignEngineer(o.id, b.rahul.id!, b.admin);
    await acceptOrder(o.id, b.rahul);
    await addDailyUpdate(o.id, { stageId: b.stage("Testing").id, progress: "90", workCompleted: "Tested" }, b.rahul);
    await uploadMachinePhotos(o.id, await photoFiles(8), b.rahul);

    await smtp.close(); // simulate SMTP outage
    await completeAndSubmit(o.id, null, b.rahul);
    const failed = await prisma.notification.findFirstOrThrow({ where: { orderId: o.id, type: "COMPLETION_EMAIL" } });
    expect(failed.status).toBe("FAILED");
    expect(await prisma.inAppNotification.count({ where: { title: "Completion email could not be sent. Retry email." } })).toBe(1);

    smtp = await startSmtp();
    await resendCompletionEmail(o.id, b.admin);
    expect(smtp.mails).toHaveLength(1);
    expect((smtp.mails[0]!.raw.match(/Content-Type: image\/jpeg/g) ?? []).length).toBe(8);
  });
});
