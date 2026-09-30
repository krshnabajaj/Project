import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { systemLog, errorMessage } from "../system-log";

/** Convert thrown errors into a user-safe ActionState. Unexpected errors are logged, never swallowed. */
export async function toActionError(err: unknown, context: string): Promise<ActionState> {
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors, ts: Date.now() };
  }
  if (err instanceof AppError) return { ok: false, error: err.message, data: err.details, ts: Date.now() };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "This record conflicts with an existing one (duplicate value).", ts: Date.now() };
  }
  await systemLog("ERROR", "action", `${context}: ${errorMessage(err)}`, { stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined });
  return { ok: false, error: "Something went wrong. The error has been logged for the administrator.", ts: Date.now() };
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function ok(message?: string, data?: unknown): ActionState {
  return { ok: true, message, data, ts: Date.now() };
}
