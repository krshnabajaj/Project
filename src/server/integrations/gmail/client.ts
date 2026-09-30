import type { gmail_v1 } from "@googleapis/gmail";

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string | null;
  from: string; // raw header, e.g. "ABC Hospital <purchase@abchospital.com>"
  subject: string;
  date: Date | null;
  bodyText: string;
  labelIds: string[];
  attachments: GmailAttachmentMeta[];
}

/** Narrow interface over the Gmail API — lets the sync pipeline be tested without Google. */
export interface GmailApi {
  listMessageIds(query: string, max: number): Promise<{ id: string; threadId: string | null }[]>;
  getMessage(id: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  watch?(topicName: string, labelIds?: string[]): Promise<{ historyId: string | null; expiration: Date | null }>;
}

export class GoogleGmailApi implements GmailApi {
  constructor(private gmail: gmail_v1.Gmail) {}

  async listMessageIds(query: string, max: number) {
    const out: { id: string; threadId: string | null }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: Math.min(100, max - out.length),
        pageToken,
      });
      for (const m of res.data.messages ?? []) if (m.id) out.push({ id: m.id, threadId: m.threadId ?? null });
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && out.length < max);
    return out;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const res = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
    return parseGmailMessage(res.data);
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const res = await this.gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    return Buffer.from(res.data.data ?? "", "base64url");
  }

  async watch(topicName: string, labelIds?: string[]) {
    const res = await this.gmail.users.watch({
      userId: "me",
      requestBody: { topicName, labelIds: labelIds?.length ? labelIds : ["INBOX"], labelFilterBehavior: "include" },
    });
    return {
      historyId: res.data.historyId ?? null,
      expiration: res.data.expiration ? new Date(Number(res.data.expiration)) : null,
    };
  }
}

export function parseGmailMessage(msg: gmail_v1.Schema$Message): GmailMessage {
  const headers = new Map<string, string>();
  for (const h of msg.payload?.headers ?? []) if (h.name && h.value) headers.set(h.name.toLowerCase(), h.value);

  const attachments: GmailAttachmentMeta[] = [];
  let plain = "";
  let html = "";
  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
      });
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      plain += Buffer.from(part.body.data, "base64url").toString("utf8") + "\n";
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html += Buffer.from(part.body.data, "base64url").toString("utf8") + "\n";
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(msg.payload);

  const dateHeader = headers.get("date");
  const internal = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
  return {
    id: msg.id!,
    threadId: msg.threadId ?? null,
    from: headers.get("from") ?? "",
    subject: headers.get("subject") ?? "",
    date: internal ?? (dateHeader ? new Date(dateHeader) : null),
    bodyText: plain.trim() || htmlToText(html),
    labelIds: msg.labelIds ?? [],
    attachments,
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "ABC Hospital <purchase@abc.com>" → { name: "ABC Hospital", email: "purchase@abc.com" } */
export function parseAddress(raw: string): { name: string | null; email: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2]!.trim().toLowerCase() };
  const email = raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase() ?? null;
  return { name: null, email };
}
