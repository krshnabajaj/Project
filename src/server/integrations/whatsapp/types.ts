export interface WhatsAppMessage {
  /** E.164 phone number, e.g. +919876543210 */
  to: string;
  body: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  /** Returns provider message id. Throws WhatsAppError on failure. */
  send(msg: WhatsAppMessage): Promise<{ providerMessageId: string | null }>;
}

export class WhatsAppError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  const withPlus = cleaned.startsWith("+") ? cleaned : cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : `+${cleaned}`;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) throw new WhatsAppError(`Invalid phone number "${raw}" (use E.164, e.g. +919876543210)`, false);
  return withPlus;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
