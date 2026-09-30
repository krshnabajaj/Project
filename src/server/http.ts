import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, httpStatusFor } from "@/lib/errors";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { systemLog, errorMessage } from "./system-log";

/**
 * CSRF protection for cookie-authenticated mutating route handlers: the Origin
 * (or Referer) must match this app. Server Actions get the same check from Next.js.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!origin || !allowed.has(origin)) throw new AppError("Cross-site request blocked.", "FORBIDDEN");
}

export function assertRateLimit(key: string, limit: number, windowMs: number) {
  const r = rateLimit(key, limit, windowMs);
  if (!r.ok) throw new AppError(`Too many requests. Try again in ${r.retryAfterSeconds}s.`, "LIMIT");
}

export async function jsonError(err: unknown, context: string) {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  if (err instanceof AppError) return NextResponse.json({ error: err.message, details: err.details }, { status: httpStatusFor(err) });
  await systemLog("ERROR", "api", `${context}: ${errorMessage(err)}`);
  return NextResponse.json({ error: "Something went wrong. The error has been logged." }, { status: 500 });
}

export function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
