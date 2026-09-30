import { env } from "@/lib/env";
import { MetaWhatsAppProvider } from "./meta";
import { TwilioWhatsAppProvider } from "./twilio";
import type { WhatsAppProvider } from "./types";

let override: WhatsAppProvider | null | undefined;

export interface WhatsAppStatus {
  provider: "meta" | "twilio" | "disabled" | string;
  configured: boolean;
  problem?: string;
}

export function whatsAppStatus(): WhatsAppStatus {
  if (override) return { provider: override.name, configured: true };
  const e = env();
  if (e.WHATSAPP_PROVIDER === "disabled") {
    return { provider: "disabled", configured: false, problem: "WHATSAPP_PROVIDER is set to 'disabled'." };
  }
  const required =
    e.WHATSAPP_PROVIDER === "meta"
      ? (["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const)
      : (["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_FROM_NUMBER"] as const);
  const missing = required.filter((k) => !e[k]);
  if (missing.length) return { provider: e.WHATSAPP_PROVIDER, configured: false, problem: `Missing ${missing.join(", ")}` };
  return { provider: e.WHATSAPP_PROVIDER, configured: true };
}

/** Returns the configured provider, or null when WhatsApp is not configured (deliveries are then recorded as SKIPPED). */
export function whatsApp(): WhatsAppProvider | null {
  if (override !== undefined) return override;
  const e = env();
  if (!whatsAppStatus().configured) return null;
  if (e.WHATSAPP_PROVIDER === "meta") {
    return new MetaWhatsAppProvider({
      apiUrl: e.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0",
      accessToken: e.WHATSAPP_ACCESS_TOKEN!,
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID!,
      templateName: e.WHATSAPP_TEMPLATE_NAME,
      templateLang: e.WHATSAPP_TEMPLATE_LANG,
    });
  }
  return new TwilioWhatsAppProvider({
    // Ignore a leftover Meta Graph URL when switching providers.
    apiUrl:
      e.WHATSAPP_API_URL && !e.WHATSAPP_API_URL.includes("facebook.com")
        ? e.WHATSAPP_API_URL
        : "https://api.twilio.com/2010-04-01",
    accountSid: e.WHATSAPP_PHONE_NUMBER_ID!,
    authToken: e.WHATSAPP_ACCESS_TOKEN!,
    fromNumber: e.WHATSAPP_FROM_NUMBER!,
  });
}

/** Test hook: undefined = use env, null = force "not configured". */
export function setWhatsAppProvider(p: WhatsAppProvider | null | undefined) {
  override = p;
}

export * from "./types";
