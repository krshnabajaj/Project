"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { authorize } from "../auth/session";
import { formObject, ok, toActionError } from "./safe";
import * as orders from "../services/orders";
import { resolveDuplicate, type DuplicateResolution } from "../services/purchase-orders";
import { markMachineCompleted, submitCompletionPhotos, completeAndSubmit, resendCompletionEmail } from "../services/completion";
import { deleteMachinePhoto } from "../services/images";
import { markPacked, markReadyForDispatch, markDispatched, closeOrder } from "../services/dispatch";
import { retryNotification } from "../services/notifications";

function refresh(orderId?: string) {
  revalidatePath("/", "layout");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

/** Order form → service input (existing customer or inline new customer). */
function orderPayload(fd: FormData) {
  const f = formObject(fd);
  const mode = f.customerMode ?? "existing";
  return {
    ...f,
    customerId: mode === "existing" ? f.customerId : undefined,
    newCustomer:
      mode === "new"
        ? {
            name: f["newCustomer.name"] ?? "",
            billingAddress: f["newCustomer.billingAddress"],
            shippingAddress: f["newCustomer.shippingAddress"],
            contactPerson: f["newCustomer.contactPerson"],
            email: f["newCustomer.email"],
            phone: f["newCustomer.phone"],
          }
        : undefined,
  };
}

export async function createOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const user = await authorize("ADMIN");
    const order = await orders.createManualOrder(orderPayload(fd), user, { allowDuplicate: fd.get("allowDuplicate") === "1" });
    id = order.id;
    refresh();
  } catch (err) {
    if (err instanceof orders.DuplicateWarning) {
      return { ok: false, error: "Possible duplicate PO detected.", data: { duplicates: err.candidates }, ts: Date.now() };
    }
    return toActionError(err, "create order");
  }
  redirect(`/orders/${id}?created=1`);
}

export async function updateOrderAction(orderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    await orders.updateOrder(orderId, orderPayload(fd), user);
    refresh(orderId);
    return ok("Order saved.");
  } catch (err) {
    return toActionError(err, "update order");
  }
}

type Simple = (orderId: string, _: ActionState, fd: FormData) => Promise<ActionState>;

function simple(context: string, fn: (orderId: string, fd: FormData) => Promise<unknown>, message: string): Simple {
  return async (orderId, _state, fd) => {
    try {
      await fn(orderId, fd);
      refresh(orderId);
      return ok(message);
    } catch (err) {
      return toActionError(err, context);
    }
  };
}

export const startReviewAction = simple("start review", async (id) => orders.startReview(id, await authorize("ADMIN")), "Review started.");
export const approveOrderAction = simple("approve", async (id) => orders.approveOrder(id, await authorize("ADMIN")), "PO approved — order created.");
export const assignEngineerAction = simple(
  "assign",
  async (id, fd) => orders.assignEngineer(id, String(fd.get("engineerId") ?? ""), await authorize("ADMIN"), { expectedCompletionDate: (fd.get("expectedCompletionDate") as string) || null }),
  "Engineer assigned and notified.",
);
export const acceptOrderAction = simple("accept", async (id) => orders.acceptOrder(id, await authorize("ENGINEER")), "Order accepted. Admin has been notified.");
export const holdOrderAction = simple("hold", async (id, fd) => orders.holdOrder(id, String(fd.get("reason") ?? ""), await authorize("ADMIN")), "Order put on hold.");
export const resumeOrderAction = simple("resume", async (id) => orders.resumeOrder(id, await authorize("ADMIN")), "Order resumed.");
export const cancelOrderAction = simple("cancel", async (id, fd) => orders.cancelOrder(id, String(fd.get("reason") ?? ""), await authorize("ADMIN")), "Order cancelled.");
export const addNoteAction = simple("note", async (id, fd) => orders.addOrderNote(id, String(fd.get("body") ?? ""), await authorize("ADMIN")), "Note added.");
export const resolveDuplicateAction = simple(
  "resolve duplicate",
  async (id, fd) => resolveDuplicate(id, String(fd.get("resolution")) as DuplicateResolution, await authorize("ADMIN"), (fd.get("targetOrderId") as string) || undefined),
  "Duplicate resolved.",
);
export const markCompletedAction = simple(
  "mark completed",
  async (id, fd) => markMachineCompleted(id, (fd.get("remarks") as string) || null, await authorize("ENGINEER")),
  "Machine marked completed. Now submit the photographs.",
);
export const submitPhotosAction = simple("submit photos", async (id) => submitCompletionPhotos(id, await authorize("ENGINEER")), "Photos submitted. Completion summary sent to admin.");
export const completeAndSubmitAction = simple(
  "complete and submit",
  async (id, fd) => completeAndSubmit(id, (fd.get("remarks") as string) || null, await authorize("ENGINEER")),
  "Machine completed and summary sent to admin.",
);
export const resendCompletionEmailAction = simple("resend completion email", async (id) => resendCompletionEmail(id, await authorize("ADMIN")), "Completion email queued.");
export const markPackedAction = simple("pack", async (id, fd) => markPacked(id, formObject(fd), await authorize("ADMIN")), "Marked as packed.");
export const markReadyAction = simple("ready", async (id) => markReadyForDispatch(id, await authorize("ADMIN")), "Order is READY FOR DISPATCH.");
export const markDispatchedAction = simple("dispatch", async (id, fd) => markDispatched(id, formObject(fd), await authorize("ADMIN")), "Order dispatched.");
export const closeOrderAction = simple("close", async (id) => closeOrder(id, await authorize("ADMIN")), "Order closed.");

export async function deletePhotoAction(imageId: string, orderId: string): Promise<ActionState> {
  try {
    const user = await authorize();
    await deleteMachinePhoto(imageId, user);
    refresh(orderId);
    return ok("Photograph deleted.");
  } catch (err) {
    return toActionError(err, "delete photo");
  }
}

export async function retryNotificationAction(notificationId: string, orderId?: string): Promise<ActionState> {
  try {
    const user = await authorize("ADMIN");
    const res = await retryNotification(notificationId, user);
    refresh(orderId);
    if (res === "SENT") return ok("Notification sent.");
    if (res === "SKIPPED") return { ok: false, error: "Not sent — the channel is not configured. See Settings.", ts: Date.now() };
    return { ok: false, error: "Delivery failed again. Check the error details and System Logs.", ts: Date.now() };
  } catch (err) {
    return toActionError(err, "retry notification");
  }
}
