import { env } from "@/lib/env";
import { SmtpEmailTransport } from "./smtp";
import { GmailEmailTransport } from "./gmail";
import type { EmailTransport } from "./types";

let override: EmailTransport | null | undefined;

export function emailStatus(): { provider: string; configured: boolean; problem?: string } {
  if (override) return { provider: override.name, configured: true };
  const e = env();
  if (e.EMAIL_PROVIDER === "disabled") return { provider: "disabled", configured: false, problem: "EMAIL_PROVIDER is 'disabled'." };
  if (e.EMAIL_PROVIDER === "gmail") return { provider: "gmail", configured: true };
  if (!e.SMTP_HOST) return { provider: "smtp", configured: false, problem: "SMTP_HOST is not configured." };
  return { provider: "smtp", configured: true };
}

/** Configured transport, or null when email is not configured (deliveries recorded as SKIPPED). */
export function emailTransport(): EmailTransport | null {
  if (override !== undefined) return override;
  const e = env();
  if (!emailStatus().configured) return null;
  if (e.EMAIL_PROVIDER === "gmail") return new GmailEmailTransport(e.EMAIL_FROM);
  return new SmtpEmailTransport({
    host: e.SMTP_HOST!,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    from: e.EMAIL_FROM ?? e.SMTP_USER ?? "no-reply@localhost",
  });
}

export function setEmailTransport(t: EmailTransport | null | undefined) {
  override = t;
}

export type { EmailTransport, EmailMessage, EmailAttachment } from "./types";
