import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { maxUploadBytes } from "@/lib/env";
import { dateOnly } from "@/lib/utils";
import { SYSTEM_ACTOR, type Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { storage, storageKey } from "../integrations/storage";
import { extractPoFields, type PoExtraction } from "../integrations/extraction/fields";
import { extractTextFromFile, classifyAttachment } from "../integrations/extraction/text";
import { assertAdmin, lockOrder } from "./access";
import { emailDomain, findDuplicateCandidates } from "./duplicates";
import { cancelOrder } from "./orders";
import { deliverNotifications, notifyAdminsInApp, queueWhatsApp } from "./notifications";
import { messages } from "./messages";
import { removeStored } from "./images";

export interface IncomingAttachment {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface IncomingPo {
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  sender?: string | null; // raw From header
  senderName?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  receivedAt?: Date | null;
  bodyText?: string | null;
  attachments: IncomingAttachment[];
}

export interface ImportResult {
  status: "IMPORTED" | "DUPLICATE_MESSAGE";
  orderId?: string;
  purchaseOrderId?: string;
  duplicate: boolean;
  extraction?: PoExtraction;
}

const DOC_MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  csv: "text/csv",
  txt: "text/plain",
};

/** Magic-byte check so a renamed executable cannot be stored as a "PDF". */
export function sniffDocument(buf: Buffer, filename: string): { ok: boolean; mime: string; ext: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = DOC_MIME[ext];
  if (!mime) return { ok: false, mime: "application/octet-stream", ext };
  const head = buf.subarray(0, 8);
  const is = (bytes: number[]) => bytes.every((b, i) => head[i] === b);
  let ok = false;
  if (ext === "pdf") ok = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  else if (ext === "xlsx" || ext === "docx") ok = is([0x50, 0x4b, 0x03, 0x04]);
  else if (ext === "xls" || ext === "doc") ok = is([0xd0, 0xcf, 0x11, 0xe0]);
  else if (ext === "jpg" || ext === "jpeg") ok = is([0xff, 0xd8, 0xff]);
  else if (ext === "png") ok = is([0x89, 0x50, 0x4e, 0x47]);
  else if (ext === "csv" || ext === "txt") ok = !buf.subarray(0, 4096).includes(0);
  return { ok, mime, ext };
}

async function matchCustomer(extraction: PoExtraction, senderEmail: string | null | undefined) {
  const domains = [emailDomain(senderEmail), emailDomain(extraction.fields.email?.value)].filter(Boolean) as string[];
  for (const d of domains) {
    const c = await prisma.customer.findFirst({ where: { emailDomain: d } });
    if (c) return { customer: c, how: `email domain ${d}` };
  }
  const name = extraction.fields.customerName?.value;
  if (name && extraction.fields.customerName!.confidence !== "low") {
    const c = await prisma.customer.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" } } });
    if (c) return { customer: c, how: `name "${name}"` };
  }
  return null;
}

/**
 * Gmail → Process Email → Extract PO → Check Duplicate → Create Draft Order → Notify Admin.
 * Idempotent on gmailMessageId.
 */
export async function importPurchaseOrder(input: IncomingPo): Promise<ImportResult> {
  if (input.gmailMessageId) {
    const exists = await prisma.purchaseOrder.findUnique({ where: { gmailMessageId: input.gmailMessageId } });
    if (exists) return { status: "DUPLICATE_MESSAGE", orderId: exists.orderId, purchaseOrderId: exists.id, duplicate: true };
  }

  // 1. Text from attachments (+ email body)
  const attachmentInfo: { filename: string; kind: string; warning?: string; sha256: string; size: number }[] = [];
  const texts: string[] = [];
  const valid: (IncomingAttachment & { hash: string; mime: string; ext: string })[] = [];
  for (const a of input.attachments) {
    const hash = sha256(a.buffer);
    const sniff = sniffDocument(a.buffer, a.filename);
    if (!sniff.ok) {
      attachmentInfo.push({ filename: a.filename, kind: "rejected", warning: `"${a.filename}" was not stored: unsupported or mismatched file type.`, sha256: hash, size: a.buffer.length });
      continue;
    }
    if (a.buffer.length > Math.max(maxUploadBytes(), 20 * 1048576)) {
      attachmentInfo.push({ filename: a.filename, kind: "rejected", warning: `"${a.filename}" is too large to store.`, sha256: hash, size: a.buffer.length });
      continue;
    }
    const t = await extractTextFromFile(a.buffer, a.filename, sniff.mime);
    if (t.text) texts.push(t.text);
    attachmentInfo.push({ filename: a.filename, kind: t.kind, warning: t.warning, sha256: hash, size: a.buffer.length });
    valid.push({ ...a, hash, mime: sniff.mime, ext: sniff.ext });
  }
  // Attachment text first (authoritative), email body second.
  const combined = [...texts, input.bodyText ?? ""].join("\n\n");
  const extraction = extractPoFields(combined, { subject: input.subject ?? undefined, senderName: input.senderName, senderEmail: input.senderEmail });
  for (const a of attachmentInfo) if (a.warning) extraction.warnings.unshift(a.warning);
  if (!input.attachments.length) extraction.warnings.unshift("The email had no attachment — details were read from the email body only.");

  // 2. Customer match & duplicate check
  const match = await matchCustomer(extraction, input.senderEmail);
  const f = extraction.fields;
  const candidates = await findDuplicateCandidates({
    poNumber: f.poNumber?.value,
    customerId: match?.customer.id,
    customerName: f.customerName?.value,
    poDate: f.poDate?.value,
    senderEmail: input.senderEmail,
    attachmentHashes: valid.map((v) => v.hash),
  });

  // 3. Store attachments (outside the transaction; cleaned up on failure)
  const stored: { key: string; a: (typeof valid)[number] }[] = [];
  try {
    for (const a of valid) {
      const key = storageKey(`po-inbox`, "documents", a.ext);
      await storage().put(key, a.buffer, a.mime);
      stored.push({ key, a });
    }
  } catch (err) {
    await removeStored(stored.map((s) => s.key));
    throw err;
  }

  try {
    const res = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          source: input.gmailMessageId ? "GMAIL" : "MANUAL",
          status: "PO_RECEIVED",
          customerId: match?.customer.id ?? null,
          poNumber: f.poNumber?.value ?? null,
          poDate: f.poDate ? dateOnly(f.poDate.value) : null,
          deliveryDate: f.deliveryDate ? dateOnly(f.deliveryDate.value) : null,
          paymentTerms: f.paymentTerms?.value ?? null,
          referenceNumber: f.referenceNumber?.value ?? null,
          machineName: f.machineName?.value ?? null,
          machineModel: f.machineModel?.value ?? null,
          quantity: f.quantity?.value ?? null,
          specifications: f.specifications?.value ?? null,
          specialInstructions: f.specialInstructions?.value ?? null,
          unitPrice: f.unitPrice?.value ?? null,
          totalValue: f.totalValue?.value ?? null,
          tax: f.tax?.value ?? null,
          currency: f.currency?.value ?? null,
        },
      });
      const top = candidates[0];
      const po = await tx.purchaseOrder.create({
        data: {
          orderId: order.id,
          source: input.gmailMessageId ? "GMAIL" : "MANUAL",
          gmailMessageId: input.gmailMessageId ?? null,
          gmailThreadId: input.gmailThreadId ?? null,
          sender: input.sender ?? null,
          senderEmail: input.senderEmail?.toLowerCase() ?? null,
          subject: input.subject ?? null,
          receivedAt: input.receivedAt ?? new Date(),
          bodyText: input.bodyText?.slice(0, 20000) ?? null,
          extractedData: {
            fields: extraction.fields,
            attachments: attachmentInfo,
            customerMatch: match ? { id: match.customer.id, name: match.customer.name, how: match.how } : null,
          } as unknown as Prisma.InputJsonValue,
          extractionStatus: extraction.status,
          extractionWarnings: extraction.warnings,
          duplicateStatus: candidates.length ? "SUSPECTED" : "NONE",
          duplicateReasons: candidates.flatMap((c) => c.reasons.map((r) => `${c.orderNumber ?? "Draft"}: ${r}`)),
          duplicateOfOrderId: top?.orderId ?? null,
        },
      });
      for (const s of stored) {
        await tx.document.create({
          data: { orderId: order.id, purchaseOrderId: po.id, kind: "PO_ATTACHMENT", fileName: s.a.filename.slice(0, 200), mimeType: s.a.mime, size: s.a.buffer.length, storageKey: s.key, sha256: s.a.hash },
        });
      }
      const customerLabel = match?.customer.name ?? f.customerName?.value ?? input.senderEmail ?? "unknown sender";
      await audit(tx, SYSTEM_ACTOR, {
        action: AUDIT.PO_IMPORTED,
        summary: `PO ${f.poNumber?.value ?? "(number not found)"} received from ${customerLabel}${input.subject ? ` — "${input.subject}"` : ""}. Extraction: ${extraction.status.toLowerCase()}.`,
        orderId: order.id,
        entityType: "purchase_order",
        entityId: po.id,
        newValue: { gmailMessageId: input.gmailMessageId, attachments: attachmentInfo.map((a) => a.filename), warnings: extraction.warnings },
      });
      if (candidates.length) {
        await audit(tx, SYSTEM_ACTOR, {
          action: AUDIT.PO_DUPLICATE_FLAGGED,
          summary: `Possible duplicate PO detected: ${candidates.map((c) => `${c.orderNumber ?? "draft"} (${c.reasons.join("; ")})`).join(", ")}`,
          orderId: order.id,
          entityType: "purchase_order",
          entityId: po.id,
        });
      }
      const ref = { id: order.id, orderNumber: null, customerName: customerLabel, machineName: order.machineName };
      await notifyAdminsInApp(
        {
          type: "PO_RECEIVED",
          title: candidates.length ? "Possible duplicate PO detected" : "New PO received — PO requires review",
          message: `${f.poNumber?.value ?? "PO"} from ${customerLabel}${extraction.warnings.length ? ` · ${extraction.warnings[0]}` : ""}`,
          link: `/purchase-orders/${order.id}`,
          orderId: order.id,
        },
        tx,
      );
      const waId = await queueWhatsApp(tx, { event: "PO_RECEIVED", orderId: order.id, message: messages.poReceived(ref, f.poNumber?.value ?? null, customerLabel, true) });
      return { order, po, waId };
    });
    await deliverNotifications([res.waId]);
    return { status: "IMPORTED", orderId: res.order.id, purchaseOrderId: res.po.id, duplicate: candidates.length > 0, extraction };
  } catch (err) {
    await removeStored(stored.map((s) => s.key));
    // Lost a race with a concurrent import of the same Gmail message.
    if ((err as { code?: string }).code === "P2002" && input.gmailMessageId) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { gmailMessageId: input.gmailMessageId } });
      if (existing) return { status: "DUPLICATE_MESSAGE", orderId: existing.orderId, purchaseOrderId: existing.id, duplicate: true };
    }
    throw err;
  }
}

export type DuplicateResolution = "MERGE" | "IGNORE" | "CREATE_ANYWAY";

/** Admin decision on a suspected duplicate PO. */
export async function resolveDuplicate(orderId: string, resolution: DuplicateResolution, actor: Actor, targetOrderId?: string) {
  assertAdmin(actor);
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const po = await tx.purchaseOrder.findFirst({ where: { orderId, duplicateStatus: "SUSPECTED" } });
    if (!po) throw new AppError("This PO is not flagged as a possible duplicate.", "VALIDATION");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== "PO_RECEIVED" && order.status !== "PO_UNDER_REVIEW") {
      throw new AppError("Duplicate resolution is only possible while the PO is under review.", "INVALID_TRANSITION");
    }

    if (resolution === "CREATE_ANYWAY") {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { duplicateStatus: "OVERRIDDEN" } });
      if (order.status === "PO_RECEIVED") await tx.order.update({ where: { id: orderId }, data: { status: "PO_UNDER_REVIEW" } });
      await audit(tx, actor, { action: AUDIT.PO_DUPLICATE_RESOLVED, summary: `${actor.name} chose “Create anyway” for the possible duplicate PO`, orderId });
      return { orderId };
    }

    if (resolution === "IGNORE") {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { duplicateStatus: "IGNORED" } });
      await audit(tx, actor, { action: AUDIT.PO_DUPLICATE_RESOLVED, summary: `${actor.name} ignored the duplicate PO`, orderId });
      await cancelOrder(orderId, "Ignored as duplicate PO", actor, tx);
      return { orderId };
    }

    // MERGE: attach this PO and its documents to the existing order, retire the draft.
    const target = targetOrderId ?? po.duplicateOfOrderId;
    if (!target || target === orderId) throw new AppError("Select the existing order to merge into.", "VALIDATION");
    const targetOrder = await tx.order.findUnique({ where: { id: target } });
    if (!targetOrder || targetOrder.status === "CANCELLED") throw new AppError("The order to merge into no longer exists.", "VALIDATION");
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { duplicateStatus: "MERGED", orderId: target } });
    await tx.document.updateMany({ where: { orderId }, data: { orderId: target } });
    const label = targetOrder.orderNumber ?? "the existing draft";
    await audit(tx, actor, { action: AUDIT.PO_DUPLICATE_RESOLVED, summary: `${actor.name} merged this PO into ${label}`, orderId });
    await audit(tx, actor, {
      action: AUDIT.PO_DUPLICATE_RESOLVED,
      summary: `${actor.name} merged a duplicate PO email${po.subject ? ` ("${po.subject}")` : ""} and its documents into this order`,
      orderId: target,
    });
    await cancelOrder(orderId, `Merged into ${label}`, actor, tx);
    return { orderId: target };
  });
}

/** Admin attaches a document (original PO for manual orders, drawings, etc.). */
export async function uploadDocument(orderId: string, file: { name: string; buffer: Buffer }, kind: "PO_ATTACHMENT" | "OTHER", actor: Actor) {
  assertAdmin(actor);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found.", "NOT_FOUND");
  if (file.buffer.length === 0) throw new AppError("The file is empty.", "VALIDATION");
  if (file.buffer.length > maxUploadBytes()) throw new AppError(`File exceeds the ${Math.round(maxUploadBytes() / 1048576)} MB limit.`, "LIMIT");
  const sniff = sniffDocument(file.buffer, file.name);
  if (!sniff.ok) throw new AppError("Only PDF, Word (.docx/.doc), Excel (.xlsx/.xls), CSV, JPG and PNG files are allowed, and the content must match the extension.", "VALIDATION");
  const key = storageKey(orderId, "documents", sniff.ext);
  await storage().put(key, file.buffer, sniff.mime);
  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: { orderId, kind, fileName: file.name.slice(0, 200), mimeType: sniff.mime, size: file.buffer.length, storageKey: key, sha256: sha256(file.buffer), uploadedById: actor.id },
      });
      await audit(tx, actor, { action: AUDIT.DOCUMENT_UPLOADED, summary: `${actor.name} uploaded document "${doc.fileName}"`, orderId, entityType: "document", entityId: doc.id });
      return doc;
    });
  } catch (err) {
    await removeStored([key]);
    throw err;
  }
}

export { classifyAttachment };
