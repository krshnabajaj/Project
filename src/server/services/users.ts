import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { userInputSchema } from "@/lib/schemas";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { assertAdmin } from "./access";
import { hashPassword, passwordSchema } from "../auth/password";

export async function createUser(raw: unknown, password: string, actor: Actor) {
  assertAdmin(actor);
  const input = userInputSchema.parse(raw);
  const pw = passwordSchema.parse(password);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new AppError("A user with this email already exists.", "CONFLICT");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...input, passwordHash: await hashPassword(pw) } });
    await audit(tx, actor, {
      action: AUDIT.USER_CREATED,
      summary: `${actor.name} created ${input.role.toLowerCase()} account for ${user.name}`,
      entityType: "user",
      entityId: user.id,
      newValue: input,
    });
    return user;
  });
}

export async function updateUser(id: string, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = userInputSchema.parse(raw);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw new AppError("User not found.", "NOT_FOUND");
  if (id === actor.id && input.role !== "ADMIN") throw new AppError("You cannot remove your own admin role.", "VALIDATION");
  if (before.role === "ENGINEER" && input.role === "ADMIN") {
    const open = await prisma.order.count({ where: { engineerId: id, status: { in: ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"] } } });
    if (open) throw new AppError(`Reassign ${before.name}'s ${open} open order(s) before changing their role.`, "VALIDATION");
  }
  const clash = await prisma.user.findFirst({ where: { email: input.email, id: { not: id } } });
  if (clash) throw new AppError("Another user already uses this email.", "CONFLICT");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id }, data: input });
    await audit(tx, actor, {
      action: AUDIT.USER_UPDATED,
      summary: `${actor.name} updated user ${user.name}`,
      entityType: "user",
      entityId: id,
      oldValue: { name: before.name, email: before.email, phone: before.phone, role: before.role },
      newValue: input,
    });
    return user;
  });
}

export async function setUserActive(id: string, active: boolean, actor: Actor) {
  assertAdmin(actor);
  if (id === actor.id && !active) throw new AppError("You cannot deactivate your own account.", "VALIDATION");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("User not found.", "NOT_FOUND");
  if (!active && user.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: id } } });
    if (!admins) throw new AppError("At least one active admin is required.", "VALIDATION");
  }
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { active } });
    await audit(tx, actor, {
      action: AUDIT.USER_UPDATED,
      summary: `${actor.name} ${active ? "activated" : "deactivated"} ${user.name}`,
      entityType: "user",
      entityId: id,
      oldValue: { active: user.active },
      newValue: { active },
    });
  });
}

export async function resetPassword(id: string, password: string, actor: Actor) {
  if (actor.role !== "ADMIN" && actor.id !== id) throw new AppError("Not allowed.", "FORBIDDEN");
  const pw = passwordSchema.parse(password);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("User not found.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw) } });
    await audit(tx, actor, { action: AUDIT.USER_UPDATED, summary: `${actor.name} changed the password for ${user.name}`, entityType: "user", entityId: id });
  });
}
