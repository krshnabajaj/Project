import type { Tx } from "@/lib/prisma";
import { todayIso } from "@/lib/utils";

export function formatOrderNumber(year: number, seq: number) {
  return `ORD-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Atomically allocate the next internal order number (ORD-YYYY-NNNN).
 * The upsert row-locks the year's counter, so concurrent approvals can never
 * receive the same number; the orders.order_number UNIQUE index is the final guard.
 */
export async function nextOrderNumber(tx: Tx, year = Number(todayIso().slice(0, 4))): Promise<string> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO order_sequences (year, last_value) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = order_sequences.last_value + 1
    RETURNING last_value`;
  return formatOrderNumber(year, Number(rows[0]!.last_value));
}
