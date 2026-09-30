import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime } from "@/lib/utils";
import { statusLabel } from "@/lib/status";
import { storage } from "../integrations/storage";
import type { EmailAttachment, EmailMessage } from "../integrations/email";
import { getSetting } from "../settings";
import { appUrl, escapeHtml } from "./notifications";
import { systemLog, errorMessage } from "../system-log";

export function completionSubject(orderNumber: string | null, customer: string | null) {
  return `Machine Completed – ${orderNumber ?? "Order"} – ${customer ?? "Customer"}`;
}

// Stay well below Gmail's 25 MB message limit (base64 inflates by ~33%).
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Build the completion summary email from the current order data (recipients filled by caller). */
export async function buildCompletionEmail(orderId: string): Promise<Omit<EmailMessage, "to">> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      customer: true,
      engineer: true,
      stageProgress: { include: { stage: true } },
      dailyUpdates: { orderBy: { createdAt: "desc" }, take: 5, include: { stage: true } },
      images: { where: { kind: "MACHINE" }, orderBy: { createdAt: "asc" } },
    },
  });
  const company = await getSetting("company");
  const emailPrefs = await getSetting("email");
  const link = appUrl(`/orders/${order.id}`);

  const attachments: EmailAttachment[] = [];
  let total = 0;
  let skippedForSize = 0;
  if (emailPrefs.attachPhotos) {
    for (const [i, img] of order.images.entries()) {
      try {
        const obj = await storage().get(img.storageKey);
        if (total + obj.body.length > MAX_ATTACHMENT_BYTES) {
          skippedForSize++;
          continue;
        }
        total += obj.body.length;
        attachments.push({ filename: `${order.orderNumber ?? "order"}-photo-${i + 1}.jpg`, content: obj.body, contentType: obj.contentType, cid: `photo${i + 1}@oms` });
      } catch (err) {
        await systemLog("ERROR", "email", `Could not load photo ${img.id} for completion email: ${errorMessage(err)}`);
        throw new Error(`Could not load photograph "${img.fileName}" from storage: ${errorMessage(err)}`);
      }
    }
  }

  const stages = order.stageProgress
    .filter((s) => s.stage.active || s.status !== "PENDING")
    .sort((a, b) => a.stage.sequence - b.stage.sequence);
  const remarks = order.completionRemarks ?? order.dailyUpdates[0]?.workCompleted ?? "—";

  const rows: [string, string][] = [
    ["Order Number", order.orderNumber ?? "—"],
    ["Customer", order.customer?.name ?? "—"],
    ["PO Number", order.poNumber ?? "—"],
    ["PO Date", formatDate(order.poDate)],
    ["Machine", [order.machineName, order.machineModel].filter(Boolean).join(" — ") || "—"],
    ["Quantity", order.quantity ? String(order.quantity) : "—"],
    ["Engineer", order.engineer?.name ?? "—"],
    ["Assigned", formatDateTime(order.assignedAt)],
    ["Accepted", formatDateTime(order.acceptedAt)],
    ["Completion Date", formatDateTime(order.completedAt)],
    ["Expected Completion", formatDate(order.expectedCompletionDate)],
    ["Final Assembly Status", statusLabel(order.status)],
    ["Final Progress", `${order.progressPercentage}%`],
    ["Engineer Remarks", remarks],
  ];

  const td = "padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;vertical-align:top";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#111827">
<div style="max-width:720px;margin:0 auto;padding:24px">
  <div style="background:#1f2937;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75">${escapeHtml(company.name)}</div>
    <div style="font-size:20px;font-weight:600;margin-top:4px">Machine Completed — ${escapeHtml(order.orderNumber ?? "")}</div>
  </div>
  <div style="background:#fff;padding:20px 24px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="${td};width:190px;color:#6b7280">${escapeHtml(k)}</td><td style="${td};font-weight:500">${escapeHtml(v)}</td></tr>`)
      .join("")}</table>
    <h3 style="font-size:15px;margin:24px 0 8px">Assembly stages</h3>
    <table style="width:100%;border-collapse:collapse">${stages
      .map(
        (s) =>
          `<tr><td style="${td}">${s.status === "COMPLETED" ? "✔" : "○"} ${escapeHtml(s.stage.name)}</td><td style="${td};color:#6b7280">${s.completedAt ? `Completed ${escapeHtml(formatDateTime(s.completedAt))}` : escapeHtml(s.status.replace("_", " ").toLowerCase())}</td></tr>`,
      )
      .join("")}</table>
    ${
      order.dailyUpdates.length
        ? `<h3 style="font-size:15px;margin:24px 0 8px">Recent engineer updates</h3>${order.dailyUpdates
            .map(
              (u) =>
                `<p style="margin:0 0 10px;font-size:14px"><strong>${escapeHtml(formatDate(u.updateDate))}</strong> — ${escapeHtml(u.stage.name)}, ${u.progress}%<br>${escapeHtml(u.workCompleted)}${u.issues ? `<br><span style="color:#b45309">Issue: ${escapeHtml(u.issues)}</span>` : ""}</p>`,
            )
            .join("")}`
        : ""
    }
    <h3 style="font-size:15px;margin:24px 0 8px">Machine photographs (${order.images.length})</h3>
    ${
      attachments.length
        ? `<div>${attachments
            .map((a) => `<img src="cid:${a.cid}" alt="${escapeHtml(a.filename)}" style="width:48%;margin:0 1% 8px 0;border-radius:6px;border:1px solid #e5e7eb">`)
            .join("")}</div>`
        : `<p style="font-size:14px;color:#6b7280">Photographs are available in the application.</p>`
    }
    ${skippedForSize ? `<p style="font-size:13px;color:#b45309">${skippedForSize} photograph(s) were too large to attach — view them in the application.</p>` : ""}
    <p style="margin-top:24px"><a href="${escapeHtml(link)}" style="background:#1f2937;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Open order in the application</a></p>
  </div>
</div></body></html>`;

  const text = [
    `Machine Completed – ${order.orderNumber}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Assembly stages:",
    ...stages.map((s) => `  ${s.status === "COMPLETED" ? "[x]" : "[ ]"} ${s.stage.name}`),
    "",
    `Photographs: ${order.images.length} (${attachments.length} attached)`,
    `Open the order: ${link}`,
  ].join("\n");

  return { subject: completionSubject(order.orderNumber, order.customer?.name ?? null), html, text, attachments };
}
