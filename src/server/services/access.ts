import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "../actor";

/**
 * Row-level access rule: engineers only ever see orders assigned to them.
 * Every order query issued on behalf of a user must be combined with this filter.
 */
export function orderScope(actor: Actor): Prisma.OrderWhereInput {
  if (actor.role === "ADMIN" || actor.role === "SYSTEM") return {};
  return { engineerId: actor.id ?? "__none__" };
}

/** Load an order the actor may see. Unauthorized and missing look the same (no information leak). */
export async function findOrderForActor<T extends Prisma.OrderInclude>(
  orderId: string,
  actor: Actor,
  include?: T,
  db: Tx = prisma,
) {
  const order = await db.order.findFirst({ where: { id: orderId, ...orderScope(actor) }, include });
  if (!order) throw new AppError("Order not found.", "NOT_FOUND");
  return order as Prisma.OrderGetPayload<{ include: T }>;
}

export function assertAdmin(actor: Actor) {
  if (actor.role !== "ADMIN") throw new AppError("Only an admin can perform this action.", "FORBIDDEN");
}

export function assertAssignedEngineer(actor: Actor, order: { engineerId: string | null }) {
  if (actor.role !== "ENGINEER" || !actor.id || order.engineerId !== actor.id) {
    throw new AppError("Only the engineer assigned to this order can perform this action.", "FORBIDDEN");
  }
}

/** Serialize concurrent writers on the same order within a transaction. */
export async function lockOrder(tx: Tx, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
}
