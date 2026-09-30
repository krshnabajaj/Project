import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import type { Actor } from "./actor";

export const AUDIT = {
  PO_IMPORTED: "PO_IMPORTED",
  PO_REVIEW_STARTED: "PO_REVIEW_STARTED",
  PO_DUPLICATE_FLAGGED: "PO_DUPLICATE_FLAGGED",
  PO_DUPLICATE_RESOLVED: "PO_DUPLICATE_RESOLVED",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_APPROVED: "ORDER_APPROVED",
  ORDER_EDITED: "ORDER_EDITED",
  ENGINEER_ASSIGNED: "ENGINEER_ASSIGNED",
  ENGINEER_REASSIGNED: "ENGINEER_REASSIGNED",
  ENGINEER_ACCEPTED: "ENGINEER_ACCEPTED",
  STAGE_CHANGED: "STAGE_CHANGED",
  STATUS_CHANGED: "STATUS_CHANGED",
  DAILY_UPDATE_ADDED: "DAILY_UPDATE_ADDED",
  ISSUE_REPORTED: "ISSUE_REPORTED",
  PHOTO_UPLOADED: "PHOTO_UPLOADED",
  PHOTO_DELETED: "PHOTO_DELETED",
  PHOTOS_SUBMITTED: "PHOTOS_SUBMITTED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  MACHINE_COMPLETED: "MACHINE_COMPLETED",
  EMAIL_SENT: "EMAIL_SENT",
  EMAIL_FAILED: "EMAIL_FAILED",
  WHATSAPP_SENT: "WHATSAPP_SENT",
  WHATSAPP_FAILED: "WHATSAPP_FAILED",
  NOTIFICATION_SKIPPED: "NOTIFICATION_SKIPPED",
  PACKED: "PACKED",
  READY_FOR_DISPATCH: "READY_FOR_DISPATCH",
  DISPATCHED: "DISPATCHED",
  CLOSED: "CLOSED",
  ON_HOLD: "ON_HOLD",
  RESUMED: "RESUMED",
  CANCELLED: "CANCELLED",
  NOTE_ADDED: "NOTE_ADDED",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_LOGIN: "USER_LOGIN",
  USER_LOGIN_FAILED: "USER_LOGIN_FAILED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  STAGE_CONFIG_UPDATED: "STAGE_CONFIG_UPDATED",
  CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
  GMAIL_CONNECTED: "GMAIL_CONNECTED",
  GMAIL_DISCONNECTED: "GMAIL_DISCONNECTED",
  OVERDUE_ALERT: "OVERDUE_ALERT",
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export interface AuditEntry {
  action: AuditAction;
  summary: string;
  orderId?: string | null;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/** Append an audit record. Use inside the same transaction as the change it describes. */
export async function audit(db: Tx, actor: Actor, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      action: entry.action,
      summary: entry.summary,
      orderId: entry.orderId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: json(entry.oldValue),
      newValue: json(entry.newValue),
      ipAddress: actor.ip ?? null,
      userAgent: actor.userAgent ? actor.userAgent.slice(0, 300) : null,
    },
  });
}

export function auditNow(actor: Actor, entry: AuditEntry) {
  return audit(prisma, actor, entry);
}

/** Field-level diff for edit audits: returns only changed keys. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = normalize(before[key]);
    const b = normalize(after[key]);
    if (a !== b) {
      oldValue[key] = before[key] ?? null;
      newValue[key] = after[key] ?? null;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue) };
}

function normalize(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v && "toString" in v) return String(v);
  return String(v);
}
