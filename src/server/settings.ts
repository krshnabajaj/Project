import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import type { Actor } from "./actor";
import { audit, AUDIT } from "./audit";

/** Notification event types admins can enable/disable per channel. */
export const WHATSAPP_EVENT_TYPES = {
  PO_RECEIVED: "New PO received",
  ORDER_ASSIGNED: "Order assigned (to engineer)",
  ORDER_ACCEPTED: "Engineer accepted order",
  DAILY_UPDATE: "Daily progress update / stage change",
  ISSUE_REPORTED: "Issue / blocker reported",
  MACHINE_COMPLETED: "Machine completed",
  ORDER_OVERDUE: "Order overdue",
  READY_FOR_DISPATCH: "Ready for dispatch",
} as const;
export type WhatsAppEventType = keyof typeof WHATSAPP_EVENT_TYPES;

const emailList = z.array(z.string().trim().toLowerCase().pipe(z.email())).default([]);

export const settingSchemas = {
  company: z.object({
    name: z.string().trim().max(120).default("Your Company"),
    address: z.string().trim().max(500).default(""),
    phone: z.string().trim().max(40).default(""),
    email: z.string().trim().max(200).default(""),
    website: z.string().trim().max(200).default(""),
    logoUrl: z.string().trim().max(500).default(""),
  }),
  whatsapp: z.object({
    adminNumber: z.string().trim().max(20).default(""),
    enabledTypes: z
      .array(z.enum(Object.keys(WHATSAPP_EVENT_TYPES) as [WhatsAppEventType, ...WhatsAppEventType[]]))
      // READY_FOR_DISPATCH is performed by the admin themself, so it is off by default.
      .default((Object.keys(WHATSAPP_EVENT_TYPES) as WhatsAppEventType[]).filter((t) => t !== "READY_FOR_DISPATCH")),
    notifyEngineerOnAssignment: z.boolean().default(true),
  }),
  email: z.object({
    adminEmail: z.string().trim().max(200).default(""),
    completionRecipients: emailList,
    ccRecipients: emailList,
    attachPhotos: z.boolean().default(true),
  }),
  gmail: z.object({
    enabled: z.boolean().default(true),
    subjectKeywords: z.array(z.string().trim().min(1)).default(["purchase order", "PO", "order confirmation"]),
    senderAllowlist: z.array(z.string().trim().toLowerCase().min(1)).default([]),
    label: z.string().trim().default(""),
    attachmentTypes: z
      .array(z.enum(["pdf", "excel", "word", "image"]))
      .default(["pdf", "excel", "word", "image"]),
    requireAttachment: z.boolean().default(false),
    lookbackDays: z.number().int().min(1).max(90).default(7),
    extraQuery: z.string().trim().default(""),
  }),
  uploads: z.object({
    maxImageMb: z.number().positive().max(50).optional(),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const schema = settingSchemas[key];
  const parsed = schema.safeParse(row?.value ?? {});
  const value = (parsed.success ? parsed.data : schema.parse({})) as SettingValue<K>;
  return withEnvFallbacks(key, value);
}

function withEnvFallbacks<K extends SettingKey>(key: K, value: SettingValue<K>): SettingValue<K> {
  const e = env();
  if (key === "whatsapp") {
    const v = value as SettingValue<"whatsapp">;
    if (!v.adminNumber && e.ADMIN_WHATSAPP_NUMBER) v.adminNumber = e.ADMIN_WHATSAPP_NUMBER;
  }
  if (key === "email") {
    const v = value as SettingValue<"email">;
    if (!v.adminEmail && e.ADMIN_EMAIL) v.adminEmail = e.ADMIN_EMAIL;
  }
  return value;
}

export async function setSetting<K extends SettingKey>(key: K, input: unknown, actor: Actor) {
  const schema = settingSchemas[key];
  const value = schema.parse(input) as SettingValue<K>;
  await prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    await tx.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedBy: actor.id },
      update: { value: value as Prisma.InputJsonValue, updatedBy: actor.id },
    });
    await audit(tx, actor, {
      action: AUDIT.SETTINGS_UPDATED,
      summary: `${actor.name} updated ${key} settings`,
      entityType: "setting",
      entityId: key,
      oldValue: before?.value,
      newValue: value,
    });
  });
  return value;
}

export async function completionEmailRecipients(): Promise<{ to: string[]; cc: string[] }> {
  const s = await getSetting("email");
  const to = s.completionRecipients.length ? s.completionRecipients : s.adminEmail ? [s.adminEmail] : [];
  return { to, cc: s.ccRecipients };
}
