/** WhatsApp / notification message texts. Kept together so wording is consistent. */
import { formatDate } from "@/lib/utils";

interface OrderRef {
  orderNumber: string | null;
  id: string;
  customerName?: string | null;
  machineName?: string | null;
}

const ref = (o: OrderRef) => o.orderNumber ?? `Draft ${o.id.slice(-6).toUpperCase()}`;

export const messages = {
  poReceived: (o: OrderRef, poNumber: string | null, sender: string, needsReview: boolean) =>
    `New PO received${poNumber ? ` (${poNumber})` : ""} from ${o.customerName ?? sender}.` +
    `${o.machineName ? `\nMachine: ${o.machineName}` : ""}` +
    `${needsReview ? "\n⚠️ PO requires review before it becomes a production order." : ""}`,

  assignedToEngineer: (o: OrderRef, engineer: string, expected: Date | null) =>
    `Hello ${engineer}, order ${ref(o)} has been assigned to you.` +
    `\nCustomer: ${o.customerName ?? "—"}\nMachine: ${o.machineName ?? "—"}` +
    `${expected ? `\nExpected completion: ${formatDate(expected)}` : ""}` +
    `\nPlease log in to accept the order.`,

  accepted: (o: OrderRef, engineer: string) => `Order ${ref(o)} has been accepted by ${engineer}.`,

  dailyUpdate: (o: OrderRef, engineer: string, stage: string, progress: number, work: string, stageChanged: boolean) =>
    `${ref(o)}\nCustomer: ${o.customerName ?? "—"}\nEngineer: ${engineer}\n` +
    `${stageChanged ? "Stage updated" : "Stage"}: ${stage}\nProgress: ${progress}%\nUpdate: ${work}`,

  issue: (o: OrderRef, engineer: string, issue: string, delayDays: number | null) =>
    `⚠️ ${ref(o)}\nEngineer: ${engineer}\nIssue: ${issue}` +
    `${delayDays ? `\nExpected delay: ${delayDays} day${delayDays === 1 ? "" : "s"}.` : ""}`,

  completed: (o: OrderRef, engineer: string, photos: number) =>
    `${ref(o)} has been marked COMPLETED by ${engineer}. ${photos} photograph${photos === 1 ? "" : "s"} uploaded. ` +
    `Completion summary will be emailed to Admin.`,

  overdue: (o: OrderRef, engineer: string | null, expected: Date, daysLate: number) =>
    `🔴 OVERDUE: ${ref(o)}\nCustomer: ${o.customerName ?? "—"}\nEngineer: ${engineer ?? "Unassigned"}` +
    `\nExpected completion was ${formatDate(expected)} (${daysLate} day${daysLate === 1 ? "" : "s"} late).`,

  readyForDispatch: (o: OrderRef) => `${ref(o)} (${o.customerName ?? "—"}) is packed and READY FOR DISPATCH.`,
};

export { ref as orderRef };
