import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Level = "INFO" | "WARN" | "ERROR";

/**
 * Persist an operational log line (visible to admins on the System Logs page).
 * Never throws: logging must not break the operation being logged.
 */
export async function systemLog(level: Level, source: string, message: string, context?: Record<string, unknown>) {
  const line = `[${level}] ${source}: ${message}`;
  if (level === "ERROR") console.error(line, context ?? "");
  else if (level === "WARN") console.warn(line, context ?? "");
  else if (process.env.NODE_ENV !== "test") console.info(line);
  try {
    await prisma.systemLog.create({
      data: {
        level,
        source,
        message: message.slice(0, 2000),
        context: context ? (JSON.parse(JSON.stringify(context)) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.error("Failed to persist system log", err);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
