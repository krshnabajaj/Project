import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { whatsApp, whatsAppStatus } from "../integrations/whatsapp";
import { emailTransport, emailStatus, type EmailMessage } from "../integrations/email";
import { getSetting, type WhatsAppEventType } from "../settings";
import { audit, AUDIT } from "../audit";
import { SYSTEM_ACTOR, type Actor } from "../actor";
import { systemLog, errorMessage } from "../system-log";

// ------------------------------------------------------------ in-app center

export interface InAppInput {
  type: string;
  title: string;
  message: string;
  link?: string;
  orderId?: string | null;
  /** Skip if an identical-type unread notification for the same order exists within N minutes. */
  dedupeMinutes?: number;
}

export async function notifyAdminsInApp(input: InAppInput, db: Tx = prisma) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  for (const a of admins) await notifyUserInApp(a.id, input, db);
}

export async function notifyUserInApp(userId: string, input: InAppInput, db: Tx = prisma) {
  if (input.dedupeMinutes) {
    const since = new Date(Date.now() - input.dedupeMinutes * 60_000);
    const existing = await db.inAppNotification.findFirst({
      where: { userId, type: input.type, orderId: input.orderId ?? null, readAt: null, createdAt: { gte: since } },
      select: { id: true },
    });
    if (existing) return;
  }
  await db.inAppNotification.create({
    data: {
      userId,
      type: input.type,
      title: input.title.slice(0, 200),
      message: input.message.slice(0, 1000),
      link: input.link,
      orderId: input.orderId ?? null,
    },
  });
}

export async function markInAppRead(userId: string, ids: string[] | "all") {
  await prisma.inAppNotification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

export async function markInAppUnread(userId: string, id: string) {
  await prisma.inAppNotification.updateMany({ where: { userId, id }, data: { readAt: null } });
}

// ------------------------------------------------------------ outbox (WhatsApp / email)

export interface WhatsAppQueueInput {
  event: WhatsAppEventType;
  orderId?: string | null;
  message: string;
  /** Defaults to the admin WhatsApp number from settings. */
  to?: string | null;
  recipientLabel?: string;
}

/**
 * Record a WhatsApp notification in the outbox (inside the caller's transaction).
 * Returns the id to deliver after commit, or null when the admin disabled this event type.
 */
export async function queueWhatsApp(db: Tx, input: WhatsAppQueueInput): Promise<string | null> {
  const prefs = await getSetting("whatsapp");
  if (!prefs.enabledTypes.includes(input.event)) return null;
  const to = input.to ?? prefs.adminNumber;
  const row = await db.notification.create({
    data: {
      orderId: input.orderId ?? null,
      type: input.event,
      channel: "WHATSAPP",
      recipient: to || "(admin number not configured)",
      message: input.message,
      payload: { recipientLabel: input.recipientLabel ?? (input.to ? "Recipient" : "Admin") },
      status: to ? "PENDING" : "SKIPPED",
      error: to ? null : "No WhatsApp number configured. Set the admin number in Settings → WhatsApp.",
    },
  });
  return to ? row.id : null;
}

export interface EmailQueueInput {
  type: string;
  orderId?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  payload?: Record<string, unknown>;
}

export async function queueEmail(db: Tx, input: EmailQueueInput): Promise<string | null> {
  const row = await db.notification.create({
    data: {
      orderId: input.orderId ?? null,
      type: input.type,
      channel: "EMAIL",
      recipient: input.to.join(", ") || "(no recipient configured)",
      subject: input.subject,
      message: input.text,
      payload: { ...(input.payload ?? {}), cc: input.cc ?? [] } as Prisma.InputJsonValue,
      status: input.to.length ? "PENDING" : "SKIPPED",
      error: input.to.length ? null : "No email recipient configured. Set the admin email in Settings → Email.",
    },
  });
  return input.to.length ? row.id : null;
}

/** Deliver queued notifications. Never throws — failures are recorded, logged and surfaced to admins. */
export async function deliverNotifications(ids: (string | null | undefined)[]) {
  for (const id of ids) if (id) await deliverOne(id);
}

const MAX_AUTO_ATTEMPTS = 5;

/** Email types whose content is (re)built at send time from current data, e.g. the completion summary with photos. */
async function buildEmailFor(type: string, orderId: string | null): Promise<Omit<EmailMessage, "to"> | null> {
  if (type === "COMPLETION_EMAIL" && orderId) {
    const { buildCompletionEmail } = await import("./completion-email");
    return buildCompletionEmail(orderId);
  }
  return null;
}

export async function deliverOne(id: string): Promise<"SENT" | "FAILED" | "SKIPPED" | "NOOP"> {
  // Claim the row atomically so concurrent workers never double-send.
  const claimed = await prisma.notification.updateMany({
    where: { id, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PENDING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "NOOP";
  const n = await prisma.notification.findUniqueOrThrow({ where: { id }, include: { order: { select: { orderNumber: true } } } });
  const label = (n.payload as { recipientLabel?: string } | null)?.recipientLabel ?? "Admin";
  const ref = n.order?.orderNumber ? ` for ${n.order.orderNumber}` : "";

  try {
    if (n.channel === "WHATSAPP") {
      const provider = whatsApp();
      if (!provider) {
        const problem = whatsAppStatus().problem ?? "WhatsApp provider not configured";
        await markSkipped(n.id, `WhatsApp not sent: ${problem}`, n.orderId, `WhatsApp notification${ref} not sent — ${problem}`);
        return "SKIPPED";
      }
      const res = await provider.send({ to: n.recipient, body: n.message });
      await prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id },
          data: { status: "SENT", sentAt: new Date(), providerMessageId: res.providerMessageId, error: null },
        });
        await audit(tx, SYSTEM_ACTOR, {
          action: AUDIT.WHATSAPP_SENT,
          summary: `System sent WhatsApp notification to ${label}${ref}`,
          orderId: n.orderId,
          entityType: "notification",
          entityId: id,
          newValue: { type: n.type, recipient: n.recipient },
        });
      });
      return "SENT";
    }

    // EMAIL
    const transport = emailTransport();
    if (!transport) {
      const problem = emailStatus().problem ?? "Email not configured";
      await markSkipped(n.id, `Email not sent: ${problem}`, n.orderId, `Email${ref} not sent — ${problem}`);
      return "SKIPPED";
    }
    const cc = ((n.payload as { cc?: string[] } | null)?.cc ?? []).filter(Boolean);
    const built = await buildEmailFor(n.type, n.orderId);
    const message: EmailMessage = built
        ? { ...built, to: n.recipient.split(",").map((s) => s.trim()), cc }
        : {
            to: n.recipient.split(",").map((s) => s.trim()),
            cc,
            subject: n.subject ?? "Notification",
            text: n.message,
            html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(n.message)}</pre>`,
          };
    const res = await transport.send(message);
    await prisma.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: res.messageId, error: null },
      });
      await audit(tx, SYSTEM_ACTOR, {
        action: AUDIT.EMAIL_SENT,
        summary: `System sent email "${message.subject}" to ${message.to.join(", ")}${message.attachments?.length ? ` with ${message.attachments.length} attachment(s)` : ""}`,
        orderId: n.orderId,
        entityType: "notification",
        entityId: id,
      });
    });
    return "SENT";
  } catch (err) {
    const msg = errorMessage(err).slice(0, 1000);
    const isWa = n.channel === "WHATSAPP";
    await prisma.$transaction(async (tx) => {
      await tx.notification.update({ where: { id }, data: { status: "FAILED", error: msg } });
      await audit(tx, SYSTEM_ACTOR, {
        action: isWa ? AUDIT.WHATSAPP_FAILED : AUDIT.EMAIL_FAILED,
        summary: `${isWa ? "WhatsApp notification" : "Email"}${ref} to ${label} failed: ${msg}`,
        orderId: n.orderId,
        entityType: "notification",
        entityId: id,
      });
      await notifyAdminsInApp(
        {
          type: isWa ? "WHATSAPP_FAILED" : "EMAIL_FAILED",
          title: isWa ? "WhatsApp notification failed. Retry." : n.type === "COMPLETION_EMAIL" ? "Completion email could not be sent. Retry email." : "Email could not be sent. Retry.",
          message: `${n.subject ?? n.type}${ref}: ${msg}`,
          link: n.orderId ? `/orders/${n.orderId}#notifications` : "/notifications?tab=outbox",
          orderId: n.orderId,
          dedupeMinutes: 30,
        },
        tx,
      );
    });
    await systemLog("ERROR", isWa ? "whatsapp" : "email", `Delivery of notification ${id}${ref} failed: ${msg}`, { notificationId: id, attempts: n.attempts });
    return "FAILED";
  }
}

async function markSkipped(id: string, reason: string, orderId: string | null, summary: string) {
  await prisma.$transaction(async (tx) => {
    await tx.notification.update({ where: { id }, data: { status: "SKIPPED", error: reason } });
    await audit(tx, SYSTEM_ACTOR, { action: AUDIT.NOTIFICATION_SKIPPED, summary, orderId, entityType: "notification", entityId: id });
  });
  await systemLog("WARN", "notifications", summary, { notificationId: id });
}

/** Admin "Retry" button. */
export async function retryNotification(id: string, actor: Actor) {
  if (actor.role !== "ADMIN") throw new AppError("Only admins can retry notifications.", "FORBIDDEN");
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw new AppError("Notification not found.", "NOT_FOUND");
  if (n.status === "SENT") throw new AppError("This notification was already sent.", "CONFLICT");
  if (n.status === "SKIPPED") {
    // Re-resolve the recipient in case it was configured since.
    let recipient = n.recipient;
    if (n.channel === "WHATSAPP" && recipient.startsWith("(")) recipient = (await getSetting("whatsapp")).adminNumber || recipient;
    if (n.channel === "EMAIL" && recipient.startsWith("(")) {
      const s = await getSetting("email");
      recipient = (s.completionRecipients.length ? s.completionRecipients : [s.adminEmail]).filter(Boolean).join(", ") || recipient;
    }
    if (recipient.startsWith("(")) throw new AppError("No recipient configured for this notification yet. Update Settings first.", "VALIDATION");
    await prisma.notification.update({ where: { id }, data: { status: "PENDING", recipient } });
  }
  return deliverOne(id);
}

/** Background retry with backoff for transient failures. */
export async function retryFailedNotifications(now = new Date()) {
  const failed = await prisma.notification.findMany({
    where: { status: { in: ["FAILED", "PENDING"] }, attempts: { lt: MAX_AUTO_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let delivered = 0;
  for (const n of failed) {
    const backoffMs = Math.min(60, 2 ** n.attempts) * 60_000;
    // PENDING rows older than 2 minutes were interrupted mid-request (e.g. server restart).
    const due = n.status === "PENDING" ? now.getTime() - n.createdAt.getTime() > 120_000 : now.getTime() - n.updatedAt.getTime() >= backoffMs;
    if (!due) continue;
    if ((await deliverOne(n.id)) === "SENT") delivered++;
  }
  return { checked: failed.length, delivered };
}

export function appUrl(path = "") {
  return `${env().APP_URL.replace(/\/$/, "")}${path}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Admin "Send test" buttons in Settings — goes through the real provider and the outbox. */
export async function sendTestNotification(channel: "WHATSAPP" | "EMAIL", actor: Actor) {
  if (actor.role !== "ADMIN") throw new AppError("Only admins can send test notifications.", "FORBIDDEN");
  let row;
  if (channel === "WHATSAPP") {
    const to = (await getSetting("whatsapp")).adminNumber;
    if (!to) throw new AppError("Set the admin WhatsApp number first.", "VALIDATION");
    row = await prisma.notification.create({
      data: { type: "TEST", channel, recipient: to, message: `Test message from Machine Order Tracker, sent by ${actor.name}. WhatsApp notifications are working.` },
    });
  } else {
    const s = await getSetting("email");
    const to = (s.completionRecipients.length ? s.completionRecipients : [s.adminEmail]).filter(Boolean);
    if (!to.length) throw new AppError("Set the admin email first.", "VALIDATION");
    row = await prisma.notification.create({
      data: { type: "TEST", channel, recipient: to.join(", "), subject: "Test email — Machine Order Tracker", message: `This is a test email sent by ${actor.name}. Completion summaries will be delivered to this address.`, payload: { cc: s.ccRecipients } },
    });
  }
  const result = await deliverOne(row.id);
  const fresh = await prisma.notification.findUnique({ where: { id: row.id } });
  return { result, error: fresh?.error ?? null };
}
