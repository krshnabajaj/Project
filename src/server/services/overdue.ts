import { prisma } from "@/lib/prisma";
import { OVERDUE_ELIGIBLE_STATUSES } from "@/lib/status";
import { dateOnly, todayIso } from "@/lib/utils";
import { SYSTEM_ACTOR } from "../actor";
import { audit, AUDIT } from "../audit";
import { deliverNotifications, notifyAdminsInApp, queueWhatsApp } from "./notifications";
import { messages } from "./messages";

const REPEAT_EVERY_DAYS = 3;

export function overdueWhere(today = todayIso()) {
  return {
    status: { in: OVERDUE_ELIGIBLE_STATUSES as never[] },
    expectedCompletionDate: { lt: dateOnly(today) },
  };
}

/**
 * Alert the admin about overdue orders (expected completion < today).
 * Alerts on the first day an order is overdue and then every 3 days.
 */
export async function runOverdueCheck(today = todayIso()) {
  const orders = await prisma.order.findMany({ where: overdueWhere(today), include: { customer: true, engineer: true } });
  const todayDate = dateOnly(today);
  const ids: (string | null)[] = [];
  let alerted = 0;
  for (const o of orders) {
    const last = o.lastOverdueAlertOn;
    if (last && (todayDate.getTime() - last.getTime()) / 86400000 < REPEAT_EVERY_DAYS) continue;
    const daysLate = Math.round((todayDate.getTime() - o.expectedCompletionDate!.getTime()) / 86400000);
    const ref = { id: o.id, orderNumber: o.orderNumber, customerName: o.customer?.name };
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.order.updateMany({ where: { id: o.id, lastOverdueAlertOn: o.lastOverdueAlertOn }, data: { lastOverdueAlertOn: todayDate } });
      if (!fresh.count) return; // another worker handled it
      await audit(tx, SYSTEM_ACTOR, { action: AUDIT.OVERDUE_ALERT, summary: `Order is overdue by ${daysLate} day(s) — admin alerted`, orderId: o.id });
      await notifyAdminsInApp({ type: "ORDER_OVERDUE", title: `🔴 ${o.orderNumber} is overdue`, message: `${daysLate} day(s) past expected completion. Engineer: ${o.engineer?.name ?? "unassigned"}.`, link: `/orders/${o.id}`, orderId: o.id }, tx);
      ids.push(await queueWhatsApp(tx, { event: "ORDER_OVERDUE", orderId: o.id, message: messages.overdue(ref, o.engineer?.name ?? null, o.expectedCompletionDate!, daysLate) }));
      alerted++;
    });
  }
  await deliverNotifications(ids);
  return { overdue: orders.length, alerted };
}
