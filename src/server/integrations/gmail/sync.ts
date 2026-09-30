import { prisma } from "@/lib/prisma";
import { withLease } from "../../jobs/lease";
import { env } from "@/lib/env";
import { getSetting, type SettingValue } from "../../settings";
import { systemLog, errorMessage } from "../../system-log";
import { importPurchaseOrder, type IncomingAttachment } from "../../services/purchase-orders";
import { notifyAdminsInApp } from "../../services/notifications";
import { classifyAttachment } from "../extraction/text";
import { GoogleGmailApi, parseAddress, type GmailApi, type GmailMessage } from "./client";
import { gmailApiClient, isAuthError, markGmailError, GMAIL_LOST_MESSAGE } from "./oauth";

type Rules = SettingValue<"gmail">;

const q = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, "")}"` : s);

/** Build the Gmail search query from the admin's PO rules. */
export function buildSearchQuery(rules: Rules): string {
  const parts: string[] = [];
  if (rules.subjectKeywords.length) parts.push(`subject:(${rules.subjectKeywords.map(q).join(" OR ")})`);
  if (rules.senderAllowlist.length) parts.push(`from:(${rules.senderAllowlist.map(q).join(" OR ")})`);
  if (rules.label) parts.push(`label:${q(rules.label.replace(/\s+/g, "-"))}`);
  if (rules.requireAttachment) parts.push("has:attachment");
  parts.push(`newer_than:${rules.lookbackDays}d`);
  parts.push("-in:sent -in:drafts -in:trash -in:spam");
  if (rules.extraQuery) parts.push(rules.extraQuery);
  return parts.join(" ");
}

function allowedAttachment(rules: Rules, filename: string, mimeType: string): boolean {
  const kind = classifyAttachment(filename, mimeType);
  const map = { pdf: "pdf", excel: "excel", word: "word", image: "image" } as const;
  return kind in map && rules.attachmentTypes.includes(map[kind as keyof typeof map]);
}

export interface SyncSummary {
  checked: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
}

async function record(messageId: string, threadId: string | null, result: "IMPORTED" | "SKIPPED" | "DUPLICATE" | "ERROR", reason?: string, purchaseOrderId?: string) {
  await prisma.gmailProcessedMessage.upsert({
    where: { messageId },
    create: { messageId, threadId, result, reason: reason?.slice(0, 1000), purchaseOrderId },
    update: { result, reason: reason?.slice(0, 1000), purchaseOrderId, processedAt: new Date() },
  });
}

/** Process one message. Exported for tests. */
export async function processGmailMessage(api: GmailApi, msg: GmailMessage, rules: Rules): Promise<"IMPORTED" | "SKIPPED" | "DUPLICATE"> {
  const from = parseAddress(msg.from);
  const wanted = msg.attachments.filter((a) => allowedAttachment(rules, a.filename, a.mimeType));
  if (rules.requireAttachment && wanted.length === 0) {
    await record(msg.id, msg.threadId, "SKIPPED", "No PO attachment of an allowed type");
    return "SKIPPED";
  }
  const attachments: IncomingAttachment[] = [];
  for (const a of wanted) {
    if (a.size > 25 * 1048576) continue;
    attachments.push({ filename: a.filename, mimeType: a.mimeType, buffer: await api.getAttachment(msg.id, a.attachmentId) });
  }
  const res = await importPurchaseOrder({
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    sender: msg.from,
    senderName: from.name,
    senderEmail: from.email,
    subject: msg.subject,
    receivedAt: msg.date,
    bodyText: msg.bodyText,
    attachments,
  });
  if (res.status === "DUPLICATE_MESSAGE") {
    await record(msg.id, msg.threadId, "DUPLICATE", "Message already imported", res.purchaseOrderId);
    return "DUPLICATE";
  }
  await record(msg.id, msg.threadId, "IMPORTED", res.duplicate ? "Imported — flagged as possible duplicate PO" : undefined, res.purchaseOrderId);
  return "IMPORTED";
}

/**
 * Poll the connected mailbox for PO emails. Safe to run concurrently (DB lease)
 * and repeatedly (message ids are recorded; each message is processed once).
 */
export async function syncGmail(opts: { api?: GmailApi; max?: number } = {}): Promise<SyncSummary | { notRun: string }> {
  const rules = await getSetting("gmail");
  if (!rules.enabled) return { notRun: "Gmail import is disabled in settings" };
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "primary" } });
  if (!opts.api && !conn) return { notRun: "Gmail is not connected" };

  const result = await withLease("gmail-sync", 10 * 60 * 1000, () => runSync(rules, opts));
  return result ?? { notRun: "Another sync is already running" };
}

async function runSync(rules: Rules, opts: { api?: GmailApi; max?: number }): Promise<SyncSummary> {
  const summary: SyncSummary = { checked: 0, imported: 0, skipped: 0, duplicates: 0, errors: 0 };
  try {
    let api = opts.api;
    if (!api) api = new GoogleGmailApi((await gmailApiClient()).gmail);
    const query = buildSearchQuery(rules);
    const ids = await api.listMessageIds(query, opts.max ?? 200);
    const done = new Set(
      (await prisma.gmailProcessedMessage.findMany({ where: { messageId: { in: ids.map((i) => i.id) } }, select: { messageId: true } })).map((r) => r.messageId),
    );
    for (const { id } of ids) {
      if (done.has(id)) continue;
      summary.checked++;
      try {
        const msg = await api.getMessage(id);
        const r = await processGmailMessage(api, msg, rules);
        if (r === "IMPORTED") summary.imported++;
        else if (r === "DUPLICATE") summary.duplicates++;
        else summary.skipped++;
      } catch (err) {
        if (isAuthError(err)) throw err;
        summary.errors++;
        const reason = errorMessage(err);
        await record(id, null, "ERROR", reason);
        await systemLog("ERROR", "gmail", `Failed to process Gmail message ${id}: ${reason}`, { messageId: id });
        await notifyAdminsInApp({
          type: "PO_IMPORT_FAILED",
          title: "A PO email could not be imported",
          message: `Gmail message ${id}: ${reason}. You can retry it from Purchase Orders → Import log.`,
          link: "/purchase-orders?tab=log",
        });
      }
    }
    await prisma.gmailConnection.updateMany({ where: { id: "primary" }, data: { lastSyncAt: new Date(), status: "CONNECTED", lastError: null } });
    if (summary.checked) await systemLog("INFO", "gmail", `Gmail sync: ${summary.imported} imported, ${summary.duplicates} duplicate, ${summary.skipped} skipped, ${summary.errors} failed`);
    return summary;
  } catch (err) {
    if (isAuthError(err)) await markGmailError(GMAIL_LOST_MESSAGE);
    else await markGmailError(`Gmail sync failed: ${errorMessage(err)}`);
    throw err;
  }
}

/** Admin "Retry" on a failed import: forget the message so the next sync picks it up. */
export async function retryGmailMessage(messageId: string) {
  await prisma.gmailProcessedMessage.deleteMany({ where: { messageId, result: { in: ["ERROR", "SKIPPED"] } } });
}

/** Register/renew Gmail push notifications (expire after 7 days). */
export async function renewGmailWatch(api?: GmailApi) {
  const topic = env().GMAIL_PUBSUB_TOPIC;
  if (!topic) return { skipped: "GMAIL_PUBSUB_TOPIC not set — using polling only" };
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "primary" } });
  if (!conn) return { skipped: "Gmail is not connected" };
  if (conn.watchExpiration && conn.watchExpiration.getTime() - Date.now() > 36 * 3600 * 1000) return { skipped: "Watch still valid" };
  const client = api ?? new GoogleGmailApi((await gmailApiClient()).gmail);
  const rules = await getSetting("gmail");
  const res = await client.watch!(topic, rules.label ? [] : ["INBOX"]);
  await prisma.gmailConnection.update({ where: { id: "primary" }, data: { watchExpiration: res.expiration, historyId: res.historyId ?? conn.historyId } });
  await systemLog("INFO", "gmail", `Gmail push watch renewed until ${res.expiration?.toISOString() ?? "unknown"}`);
  return { renewed: true, expiration: res.expiration };
}
