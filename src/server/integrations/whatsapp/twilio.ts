import { normalizePhone, WhatsAppError, type FetchLike, type WhatsAppMessage, type WhatsAppProvider } from "./types";

export interface TwilioConfig {
  apiUrl: string; // https://api.twilio.com/2010-04-01
  accountSid: string;
  authToken: string;
  fromNumber: string; // E.164 WhatsApp-enabled sender
}

/** Twilio Programmable Messaging — WhatsApp channel. */
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";
  constructor(private cfg: TwilioConfig, private fetchImpl: FetchLike = fetch) {}

  async send(msg: WhatsAppMessage) {
    const url = `${this.cfg.apiUrl.replace(/\/$/, "")}/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;
    const form = new URLSearchParams({
      From: `whatsapp:${normalizePhone(this.cfg.fromNumber)}`,
      To: `whatsapp:${normalizePhone(msg.to)}`,
      Body: msg.body.slice(0, 1600),
    });
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new WhatsAppError(`Network error contacting Twilio: ${(err as Error).message}`, true);
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      throw new WhatsAppError(`Twilio error${data.code ? ` ${data.code}` : ""}: ${data.message ?? `HTTP ${res.status}`}`, res.status >= 500 || res.status === 429);
    }
    return { providerMessageId: data.sid ?? null };
  }
}
