import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createManualOrder, DuplicateWarning, assignEngineer, approveOrder, updateOrder, holdOrder, resumeOrder, cancelOrder } from "@/server/services/orders";
import { nextOrderNumber } from "@/server/services/order-number";
import { importPurchaseOrder, resolveDuplicate } from "@/server/services/purchase-orders";
import { todayIso } from "@/lib/utils";
import { seedBase, type Base, useRecordingWhatsApp, type RecordingWhatsApp, poPdf, SAMPLE_PO_LINES } from "./helpers";

let b: Base;
let wa: RecordingWhatsApp;
beforeEach(async () => {
  b = await seedBase();
  wa = useRecordingWhatsApp();
});

const input = (po: string, extra: Record<string, unknown> = {}) => ({ customerId: b.customer.id, poNumber: po, machineName: "Plasma Sterilizer", quantity: "1", ...extra });

describe("order creation & numbering", () => {
  it("creates a manual order with ORD-YYYY-NNNN, stage rows and an audit entry", async () => {
    const o = await createManualOrder(input("CC-1"), b.admin);
    expect(o.orderNumber).toBe(`ORD-${todayIso().slice(0, 4)}-0001`);
    expect(o.status).toBe("ORDER_CREATED");
    expect(await prisma.orderStageProgress.count({ where: { orderId: o.id } })).toBe(b.stages.length);
    expect(await prisma.auditLog.count({ where: { orderId: o.id, action: "ORDER_CREATED" } })).toBe(1);
  });

  it("creates a new customer inline", async () => {
    const o = await createManualOrder({ poNumber: "N-1", machineName: "Washer", quantity: "2", newCustomer: { name: "New Clinic", email: "po@newclinic.in" } }, b.admin);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: o.customerId! } });
    expect(c).toMatchObject({ name: "New Clinic", emailDomain: "newclinic.in" });
  });

  it("never issues the same order number twice, even concurrently", async () => {
    const numbers = await Promise.all(Array.from({ length: 25 }, () => prisma.$transaction((tx) => nextOrderNumber(tx, 2031))));
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.sort().at(-1)).toBe("ORD-2031-0025");
  });

  it("validates required fields", async () => {
    await expect(createManualOrder({ customerId: b.customer.id, poNumber: "X" }, b.admin)).rejects.toThrow(/Machine/);
    await expect(createManualOrder(input("X", { quantity: "0" }), b.admin)).rejects.toThrow();
  });

  it("edits are diffed in the audit trail with old and new values", async () => {
    const o = await createManualOrder(input("E-1"), b.admin);
    await updateOrder(o.id, { ...input("E-1"), quantity: "3" }, b.admin);
    const a = await prisma.auditLog.findFirstOrThrow({ where: { orderId: o.id, action: "ORDER_EDITED" } });
    expect(a.oldValue).toMatchObject({ quantity: 1 });
    expect(a.newValue).toMatchObject({ quantity: 3 });
  });

  it("hold / resume returns to the previous state; cancel requires a reason", async () => {
    const o = await createManualOrder(input("H-1"), b.admin);
    await assignEngineer(o.id, b.rahul.id!, b.admin);
    await holdOrder(o.id, "Customer change request", b.admin);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ON_HOLD");
    await resumeOrder(o.id, b.admin);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ASSIGNED");
    await expect(cancelOrder(o.id, " ", b.admin)).rejects.toThrow(/reason/);
  });
});

describe("duplicate PO protection", () => {
  it("warns on a manual order with the same PO number + customer", async () => {
    await createManualOrder(input("PO-4587"), b.admin);
    const err = await createManualOrder(input("po 4587"), b.admin).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateWarning);
    expect(err.candidates[0].reasons[0]).toMatch(/same customer/);
    // Admin can explicitly create anyway
    const o = await createManualOrder(input("po 4587"), b.admin, { allowDuplicate: true });
    expect(o.orderNumber).toBeTruthy();
  });

  it("never imports the same Gmail message twice", async () => {
    const pdf = await poPdf(SAMPLE_PO_LINES);
    const msg = { gmailMessageId: "msg-1", senderEmail: "purchase@abchospital.com", subject: "PO-4587", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: pdf }] };
    const first = await importPurchaseOrder(msg);
    const second = await importPurchaseOrder(msg);
    expect(first.status).toBe("IMPORTED");
    expect(second.status).toBe("DUPLICATE_MESSAGE");
    expect(await prisma.purchaseOrder.count()).toBe(1);
  });

  it("flags a re-sent PO (same attachment hash / PO number) and blocks approval until resolved", async () => {
    const pdf = await poPdf(SAMPLE_PO_LINES);
    const a = await importPurchaseOrder({ gmailMessageId: "m-a", senderEmail: "purchase@abchospital.com", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: pdf }] });
    expect(a.duplicate).toBe(false);
    const b2 = await importPurchaseOrder({ gmailMessageId: "m-b", senderEmail: "purchase@abchospital.com", subject: "FW: PO", attachments: [{ filename: "po-copy.pdf", mimeType: "application/pdf", buffer: pdf }] });
    expect(b2.duplicate).toBe(true);
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { gmailMessageId: "m-b" } });
    expect(po.duplicateStatus).toBe("SUSPECTED");
    expect(po.duplicateReasons.join(" ")).toMatch(/Identical PO attachment/);
    expect(po.duplicateReasons.join(" ")).toMatch(/Same PO number/);
    await expect(approveOrder(b2.orderId!, b.admin)).rejects.toThrow(/duplicate/i);

    // Merge moves the PO + documents to the original and cancels the draft
    await resolveDuplicate(b2.orderId!, "MERGE", b.admin);
    const draft = await prisma.order.findUniqueOrThrow({ where: { id: b2.orderId! } });
    expect(draft.status).toBe("CANCELLED");
    expect(await prisma.document.count({ where: { orderId: a.orderId! } })).toBe(2);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).duplicateStatus).toBe("MERGED");
  });

  it("supports Ignore and Create anyway", async () => {
    const pdf = await poPdf(SAMPLE_PO_LINES);
    await importPurchaseOrder({ gmailMessageId: "x1", senderEmail: "purchase@abchospital.com", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: pdf }] });
    const d1 = await importPurchaseOrder({ gmailMessageId: "x2", senderEmail: "purchase@abchospital.com", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: pdf }] });
    const d2 = await importPurchaseOrder({ gmailMessageId: "x3", senderEmail: "purchase@abchospital.com", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: pdf }] });
    await resolveDuplicate(d1.orderId!, "IGNORE", b.admin);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: d1.orderId! } })).status).toBe("CANCELLED");
    await resolveDuplicate(d2.orderId!, "CREATE_ANYWAY", b.admin);
    const approved = await approveOrder(d2.orderId!, b.admin);
    expect(approved.status).toBe("ORDER_CREATED");
    expect(approved.orderNumber).toMatch(/^ORD-\d{4}-\d{4}$/);
  });

  it("rejects attachments whose content does not match the extension", async () => {
    const r = await importPurchaseOrder({ gmailMessageId: "evil", attachments: [{ filename: "po.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ executable") }], bodyText: "PO No: 1" });
    expect(await prisma.document.count({ where: { orderId: r.orderId! } })).toBe(0);
    expect(r.extraction!.warnings.join(" ")).toMatch(/not stored/);
  });
});

describe("engineer assignment", () => {
  it("assigns, records audit, notifies engineer on WhatsApp and in-app", async () => {
    const o = await createManualOrder(input("A-1"), b.admin);
    await assignEngineer(o.id, b.rahul.id!, b.admin, { expectedCompletionDate: "2099-12-31" });
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(fresh).toMatchObject({ status: "ASSIGNED", engineerId: b.rahul.id });
    expect(fresh.expectedCompletionDate?.toISOString().slice(0, 10)).toBe("2099-12-31");
    expect(wa.sent.at(-1)).toMatchObject({ to: "+919800000011" });
    expect(wa.sent.at(-1)!.body).toContain("has been assigned to you");
    expect(await prisma.inAppNotification.count({ where: { userId: b.rahul.id!, type: "ORDER_ASSIGNED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { orderId: o.id, action: "ENGINEER_ASSIGNED" } })).toBe(1);
  });

  it("reassignment is audited with the previous engineer", async () => {
    const o = await createManualOrder(input("A-2"), b.admin);
    await assignEngineer(o.id, b.rahul.id!, b.admin);
    await assignEngineer(o.id, b.priya.id!, b.admin);
    const a = await prisma.auditLog.findFirstOrThrow({ where: { orderId: o.id, action: "ENGINEER_REASSIGNED" } });
    expect(a.summary).toContain("from Rahul to Priya");
  });
});
