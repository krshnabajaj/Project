import { prisma, type Tx } from "@/lib/prisma";
import { toIsoDate } from "@/lib/utils";

export interface DuplicateQuery {
  excludeOrderId?: string;
  poNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  poDate?: string | null; // YYYY-MM-DD
  senderEmail?: string | null;
  gmailMessageId?: string | null;
  attachmentHashes?: string[];
}

export interface DuplicateCandidate {
  orderId: string;
  orderNumber: string | null;
  poNumber: string | null;
  customerName: string | null;
  status: string;
  strength: "strong" | "possible";
  reasons: string[];
}

/** "PO-4587", "po 4587", "4587" → "4587" */
export function normalizePoNumber(po: string | null | undefined): string {
  if (!po) return "";
  return po.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(PURCHASEORDER|PO)(?=\d)/, "");
}

const GENERIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "protonmail.com"]);

export function emailDomain(email: string | null | undefined): string | null {
  const d = email?.split("@")[1]?.toLowerCase().trim();
  return d && !GENERIC_DOMAINS.has(d) ? d : null;
}

/**
 * Duplicate PO detection. Checks Gmail message id, attachment hash, PO number
 * (normalized) with customer/sender, and sender + PO date. Cancelled orders are ignored.
 */
export async function findDuplicateCandidates(q: DuplicateQuery, db: Tx = prisma): Promise<DuplicateCandidate[]> {
  const found = new Map<string, DuplicateCandidate>();
  const add = async (orderId: string, reason: string, strength: "strong" | "possible") => {
    if (orderId === q.excludeOrderId) return;
    let c = found.get(orderId);
    if (!c) {
      const o = await db.order.findUnique({ where: { id: orderId }, include: { customer: true } });
      if (!o || o.status === "CANCELLED") return;
      c = {
        orderId,
        orderNumber: o.orderNumber,
        poNumber: o.poNumber,
        customerName: o.customer?.name ?? null,
        status: o.status,
        strength,
        reasons: [],
      };
      found.set(orderId, c);
    }
    if (!c.reasons.includes(reason)) c.reasons.push(reason);
    if (strength === "strong") c.strength = "strong";
  };

  if (q.gmailMessageId) {
    const po = await db.purchaseOrder.findUnique({ where: { gmailMessageId: q.gmailMessageId } });
    if (po) await add(po.orderId, "Same Gmail message was already imported", "strong");
  }

  if (q.attachmentHashes?.length) {
    const docs = await db.document.findMany({ where: { sha256: { in: q.attachmentHashes } }, select: { orderId: true, fileName: true } });
    for (const d of docs) await add(d.orderId, `Identical PO attachment already imported ("${d.fileName}")`, "strong");
  }

  const norm = normalizePoNumber(q.poNumber);
  if (norm) {
    const rows = await db.$queryRaw<{ id: string; customer_id: string | null; sender: string | null; cname: string | null }[]>`
      SELECT o.id, o.customer_id, c.name AS cname,
             (SELECT p.sender_email FROM purchase_orders p WHERE p.order_id = o.id ORDER BY p.created_at LIMIT 1) AS sender
      FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.status <> 'CANCELLED'
        AND regexp_replace(regexp_replace(upper(coalesce(o.po_number, '')), '[^A-Z0-9]', '', 'g'), '^(PURCHASEORDER|PO)(?=[0-9])', '') = ${norm}`;
    const qDomain = emailDomain(q.senderEmail);
    for (const r of rows) {
      const sameCustomer =
        (q.customerId && r.customer_id === q.customerId) ||
        (q.customerName && r.cname && r.cname.trim().toLowerCase() === q.customerName.trim().toLowerCase()) ||
        (qDomain && emailDomain(r.sender) === qDomain);
      if (sameCustomer) await add(r.id, `Same PO number (${q.poNumber}) from the same customer`, "strong");
      else await add(r.id, `Same PO number (${q.poNumber}) on another customer's order`, "possible");
    }
  }

  if (q.senderEmail && q.poDate) {
    const pos = await db.purchaseOrder.findMany({
      where: { senderEmail: q.senderEmail.toLowerCase(), order: { poDate: new Date(`${q.poDate}T00:00:00.000Z`) } },
      select: { orderId: true },
    });
    for (const p of pos) await add(p.orderId, `Same sender (${q.senderEmail}) and PO date (${toIsoDate(q.poDate)})`, "possible");
  }

  return [...found.values()].sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1));
}
