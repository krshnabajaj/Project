"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/errors";
import { authorize, getCurrentUser } from "../auth/session";
import { formObject, ok, toActionError } from "./safe";
import { setSetting, type SettingKey } from "../settings";
import { createStage, updateStage, moveStage } from "../services/stages";
import { createUser, updateUser, setUserActive, resetPassword } from "../services/users";
import { saveCustomer } from "../services/customers";
import { markInAppRead, markInAppUnread, sendTestNotification } from "../services/notifications";
import { disconnectGmail } from "../integrations/gmail/oauth";
import { syncGmail, retryGmailMessage } from "../integrations/gmail/sync";
import { runJob } from "../jobs";
import { rateLimit } from "@/lib/rate-limit";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function settingsPayload(key: SettingKey, fd: FormData) {
  const f = formObject(fd);
  switch (key) {
    case "company":
      return f;
    case "whatsapp":
      return { adminNumber: f.adminNumber, enabledTypes: fd.getAll("enabledTypes").map(String), notifyEngineerOnAssignment: f.notifyEngineerOnAssignment === "on" };
    case "email":
      return { adminEmail: f.adminEmail, completionRecipients: list(f.completionRecipients), ccRecipients: list(f.ccRecipients), attachPhotos: f.attachPhotos === "on" };
    case "gmail":
      return {
        enabled: f.enabled === "on",
        subjectKeywords: list(f.subjectKeywords),
        senderAllowlist: list(f.senderAllowlist),
        label: f.label,
        attachmentTypes: fd.getAll("attachmentTypes").map(String),
        requireAttachment: f.requireAttachment === "on",
        lookbackDays: Number(f.lookbackDays || 7),
        extraQuery: f.extraQuery,
      };
    default:
      throw new AppError("Unknown settings section.", "VALIDATION");
  }
}

export async function saveSettingsAction(key: SettingKey, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    if (key === "whatsapp") {
      const n = String(fd.get("adminNumber") ?? "").trim();
      if (n && !/^\+[1-9]\d{7,14}$/.test(n.replace(/[\s-]/g, ""))) throw new AppError("Enter the admin WhatsApp number in international format, e.g. +919876543210.", "VALIDATION");
    }
    await setSetting(key, settingsPayload(key, fd), user);
    revalidatePath("/settings");
    return ok("Settings saved.");
  } catch (err) {
    return toActionError(err, `save ${key} settings`);
  }
}

export async function saveStageAction(stageId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const f = formObject(fd);
    if (stageId) await updateStage(stageId, { ...f, active: f.active === "on" }, user);
    else await createStage(f, user);
    revalidatePath("/settings");
    return ok(stageId ? "Stage updated." : "Stage added.");
  } catch (err) {
    return toActionError(err, "save stage");
  }
}

export async function moveStageAction(stageId: string, direction: "up" | "down"): Promise<ActionState> {
  try {
    await moveStage(stageId, direction, await authorize("ADMIN"));
    revalidatePath("/settings");
    return ok();
  } catch (err) {
    return toActionError(err, "move stage");
  }
}

export async function saveUserAction(userId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const admin = await authorize("ADMIN");
    const f = formObject(fd);
    if (userId) {
      await updateUser(userId, f, admin);
      if (f.password) await resetPassword(userId, f.password, admin);
    } else {
      if (!f.password) throw new AppError("Set an initial password.", "VALIDATION");
      await createUser(f, f.password, admin);
    }
    revalidatePath("/engineers");
    revalidatePath("/settings");
    return ok(userId ? "User updated." : "User created.");
  } catch (err) {
    return toActionError(err, "save user");
  }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionState> {
  try {
    await setUserActive(userId, active, await authorize("ADMIN"));
    revalidatePath("/engineers");
    revalidatePath("/settings");
    return ok(active ? "User activated." : "User deactivated.");
  } catch (err) {
    return toActionError(err, "toggle user");
  }
}

export async function changeOwnPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await authorize();
    const pw = String(fd.get("password") ?? "");
    if (pw !== String(fd.get("confirm") ?? "")) throw new AppError("Passwords do not match.", "VALIDATION");
    await resetPassword(user.id, pw, user);
    return ok("Password changed.");
  } catch (err) {
    return toActionError(err, "change password");
  }
}

export async function saveCustomerAction(customerId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saveCustomer(customerId, formObject(fd), await authorize("ADMIN"));
    revalidatePath("/customers");
    return ok(customerId ? "Customer updated." : "Customer created.");
  } catch (err) {
    return toActionError(err, "save customer");
  }
}

export async function markNotificationsReadAction(ids: string[] | "all"): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markInAppRead(user.id, ids);
  revalidatePath("/", "layout");
}

export async function markNotificationUnreadAction(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markInAppUnread(user.id, id);
  revalidatePath("/", "layout");
}

export async function disconnectGmailAction(): Promise<ActionState> {
  try {
    await disconnectGmail(await authorize("ADMIN"));
    revalidatePath("/settings");
    return ok("Gmail disconnected.");
  } catch (err) {
    return toActionError(err, "disconnect gmail");
  }
}

export async function syncGmailNowAction(): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    if (!rateLimit(`gmail-sync:${user.id}`, 6, 60_000).ok) throw new AppError("Please wait a minute before syncing again.", "LIMIT");
    const res = await syncGmail();
    revalidatePath("/", "layout");
    if ("notRun" in res) return { ok: false, error: res.notRun, ts: Date.now() };
    return ok(`Checked ${res.checked} new email(s): ${res.imported} imported, ${res.duplicates} duplicate, ${res.skipped} skipped, ${res.errors} failed.`);
  } catch (err) {
    return toActionError(err, "sync gmail");
  }
}

export async function retryGmailMessageAction(messageId: string): Promise<ActionState> {
  try {
    await authorize("ADMIN");
    await retryGmailMessage(messageId);
    const res = await syncGmail();
    revalidatePath("/purchase-orders");
    return "notRun" in res ? { ok: false, error: res.notRun, ts: Date.now() } : ok(`Retried: ${res.imported} imported, ${res.errors} failed.`);
  } catch (err) {
    return toActionError(err, "retry gmail message");
  }
}

export async function runOverdueCheckAction(): Promise<ActionState> {
  try {
    await authorize("ADMIN");
    const res = await runJob("overdue-check");
    revalidatePath("/", "layout");
    return res.ok ? ok(`Overdue check complete: ${JSON.stringify(res.result)}`) : { ok: false, error: res.error, ts: Date.now() };
  } catch (err) {
    return toActionError(err, "overdue check");
  }
}

export async function sendTestNotificationAction(channel: "WHATSAPP" | "EMAIL"): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const { result, error } = await sendTestNotification(channel, user);
    if (result === "SENT") return ok(`Test ${channel === "WHATSAPP" ? "WhatsApp message" : "email"} sent.`);
    return { ok: false, error: error ?? `Test ${result.toLowerCase()}.`, ts: Date.now() };
  } catch (err) {
    return toActionError(err, "test notification");
  }
}
