import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { assertAdmin } from "./access";

export const DEFAULT_STAGES: { name: string; phase: "ASSEMBLY" | "TESTING" | "FINAL"; defaultProgress: number }[] = [
  { name: "Material Issued", phase: "ASSEMBLY", defaultProgress: 5 },
  { name: "Mechanical Assembly", phase: "ASSEMBLY", defaultProgress: 25 },
  { name: "Electrical Assembly", phase: "ASSEMBLY", defaultProgress: 45 },
  { name: "Plumbing / Piping", phase: "ASSEMBLY", defaultProgress: 55 },
  { name: "Control Panel / PLC", phase: "ASSEMBLY", defaultProgress: 65 },
  { name: "Software / Programming", phase: "ASSEMBLY", defaultProgress: 75 },
  { name: "Testing", phase: "TESTING", defaultProgress: 85 },
  { name: "Final Inspection", phase: "TESTING", defaultProgress: 95 },
  { name: "Machine Completed", phase: "FINAL", defaultProgress: 100 },
];

const stageSchema = z.object({
  name: z.string().trim().min(2, "Stage name is required").max(60),
  phase: z.enum(["ASSEMBLY", "TESTING", "FINAL"]),
  defaultProgress: z.coerce.number().int().min(0).max(100),
});

export async function listStages(includeInactive = false) {
  return prisma.assemblyStage.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { sequence: "asc" } });
}

export async function createStage(raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = stageSchema.parse(raw);
  const exists = await prisma.assemblyStage.findUnique({ where: { name: input.name } });
  if (exists) throw new AppError(`A stage called "${input.name}" already exists.`, "CONFLICT");
  // New stages go before the final "completed" stage.
  const final = await prisma.assemblyStage.findFirst({ where: { phase: "FINAL" }, orderBy: { sequence: "asc" } });
  const max = await prisma.assemblyStage.aggregate({ _max: { sequence: true } });
  return prisma.$transaction(async (tx) => {
    let sequence = (max._max.sequence ?? 0) + 10;
    if (final && input.phase !== "FINAL") {
      sequence = final.sequence;
      await tx.assemblyStage.updateMany({ where: { sequence: { gte: final.sequence } }, data: { sequence: { increment: 10 } } });
    }
    const stage = await tx.assemblyStage.create({ data: { ...input, sequence } });
    await audit(tx, actor, { action: AUDIT.STAGE_CONFIG_UPDATED, summary: `${actor.name} added assembly stage "${stage.name}"`, entityType: "stage", entityId: stage.id, newValue: input });
    return stage;
  });
}

export async function updateStage(id: string, raw: unknown, actor: Actor) {
  assertAdmin(actor);
  const input = stageSchema.extend({ active: z.boolean() }).parse(raw);
  const before = await prisma.assemblyStage.findUnique({ where: { id } });
  if (!before) throw new AppError("Stage not found.", "NOT_FOUND");
  if (before.phase === "FINAL" && !input.active) {
    const otherFinal = await prisma.assemblyStage.count({ where: { phase: "FINAL", active: true, id: { not: id } } });
    if (!otherFinal) throw new AppError("The final “completed” stage cannot be deactivated.", "VALIDATION");
  }
  const dup = await prisma.assemblyStage.findFirst({ where: { name: input.name, id: { not: id } } });
  if (dup) throw new AppError(`A stage called "${input.name}" already exists.`, "CONFLICT");
  return prisma.$transaction(async (tx) => {
    const stage = await tx.assemblyStage.update({ where: { id }, data: input });
    await audit(tx, actor, {
      action: AUDIT.STAGE_CONFIG_UPDATED,
      summary: `${actor.name} updated assembly stage "${stage.name}"${before.active !== input.active ? (input.active ? " (activated)" : " (deactivated)") : ""}`,
      entityType: "stage",
      entityId: id,
      oldValue: { name: before.name, phase: before.phase, defaultProgress: before.defaultProgress, active: before.active },
      newValue: input,
    });
    return stage;
  });
}

export async function moveStage(id: string, direction: "up" | "down", actor: Actor) {
  assertAdmin(actor);
  const stages = await prisma.assemblyStage.findMany({ orderBy: { sequence: "asc" } });
  const idx = stages.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= stages.length) return;
  const a = stages[idx]!;
  const b = stages[swapWith]!;
  await prisma.$transaction(async (tx) => {
    await tx.assemblyStage.update({ where: { id: a.id }, data: { sequence: b.sequence } });
    await tx.assemblyStage.update({ where: { id: b.id }, data: { sequence: a.sequence } });
    await audit(tx, actor, { action: AUDIT.STAGE_CONFIG_UPDATED, summary: `${actor.name} moved stage "${a.name}" ${direction}`, entityType: "stage", entityId: a.id });
  });
}

export async function ensureDefaultStages() {
  const count = await prisma.assemblyStage.count();
  if (count) return;
  await prisma.assemblyStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ ...s, sequence: (i + 1) * 10 })) });
}
