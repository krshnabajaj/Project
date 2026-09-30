import MailComposer from "nodemailer/lib/mail-composer";
import { gmailApiClient } from "../gmail/oauth";
import type { EmailMessage, EmailTransport } from "./types";

/** Sends through the connected company Gmail account (gmail.send scope). */
export class GmailEmailTransport implements EmailTransport {
  readonly name = "gmail";
  constructor(private from?: string) {}

  async send(msg: EmailMessage) {
    const { gmail, email } = await gmailApiClient();
    const mime = await new MailComposer({
      from: this.from ?? email,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc : undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid })),
    })
      .compile()
      .build();
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw: mime.toString("base64url") } });
    return { messageId: res.data.id ?? null };
  }
}
