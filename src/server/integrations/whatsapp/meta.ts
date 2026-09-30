import { normalizePhone, WhatsAppError, type FetchLike, type WhatsAppMessage, type WhatsAppProvider } from "./types";

export interface MetaConfig {
  apiUrl: string; // https://graph.facebook.com/v21.0
  accessToken: string;
  phoneNumberId: string;
  /** Approved template (one {{1}} body parameter). Required for business-initiated
   *  messages outside the 24h customer-service window. */
  templateName?: string;
  templateLang?: string;
}

/** Meta WhatsApp Business Cloud API. */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";
  constructor(private cfg: MetaConfig, private fetchImpl: FetchLike = fetch) {}

  buildPayload(msg: WhatsAppMessage) {
    const to = normalizePhone(msg.to).slice(1); // Meta expects digits only
    if (this.cfg.templateName) {
      // Template parameters may not contain newlines/tabs or >4 consecutive spaces.
      const text = msg.body.replace(/[\t\r]/g, " ").replace(/\n+/g, " | ").replace(/ {4,}/g, "   ").slice(0, 1024);
      return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: this.cfg.templateName,
          language: { code: this.cfg.templateLang || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      };
    }
    return { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: msg.body.slice(0, 4096) } };
  }

  async send(msg: WhatsAppMessage) {
    const url = `${this.cfg.apiUrl.replace(/\/$/, "")}/${encodeURIComponent(this.cfg.phoneNumberId)}/messages`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(this.buildPayload(msg)),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new WhatsAppError(`Network error contacting WhatsApp Cloud API: ${(err as Error).message}`, true);
    }
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };
    if (!res.ok || data.error) {
      const detail = data.error?.error_data?.details ?? data.error?.message ?? `HTTP ${res.status}`;
      throw new WhatsAppError(`WhatsApp Cloud API error${data.error?.code ? ` ${data.error.code}` : ""}: ${detail}`, res.status >= 500 || res.status === 429);
    }
    return { providerMessageId: data.messages?.[0]?.id ?? null };
  }
}
