import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { customerInputSchema } from "@/lib/schemas";
import type { Actor } from "../actor";
import { audit, AUDIT, diff } from "../audit";
import { assertAdmin } from "./access";
import { emailDomain } from "./duplicates";

export async function saveCustomer(id: string | null, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = customerInputSchema.parse(raw);
  const data = { ...input, emailDomain: emailDomain(input.email) };
  const clash = await prisma.customer.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new AppError(`A customer named "${clash.name}" already exists.`, "CONFLICT");
  return prisma.$transaction(async (tx) => {
    if (!id) {
      const c = await tx.customer.create({ data });
      await audit(tx, actor, { action: AUDIT.CUSTOMER_UPDATED, summary: `${actor.name} created customer ${c.name}`, entityType: "customer", entityId: c.id, newValue: input });
      return c;
    }
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw new AppError("Customer not found.", "NOT_FOUND");
    const c = await tx.customer.update({ where: { id }, data });
    const d = diff(before as unknown as Record<string, unknown>, input as Record<string, unknown>);
    await audit(tx, actor, { action: AUDIT.CUSTOMER_UPDATED, summary: `${actor.name} updated customer ${c.name}`, entityType: "customer", entityId: id, oldValue: d.oldValue, newValue: d.newValue });
    return c;
  });
}
