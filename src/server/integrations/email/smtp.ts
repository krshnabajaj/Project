import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailTransport } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export class SmtpEmailTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: Transporter;

  constructor(private cfg: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }

  async send(msg: EmailMessage) {
    const info = await this.transporter.sendMail({
      from: this.cfg.from,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc : undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
    });
    return { messageId: info.messageId ?? null };
  }
}
