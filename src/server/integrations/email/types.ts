export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Content-ID for inline images referenced as cid:... in HTML */
  cid?: string;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailTransport {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ messageId: string | null }>;
}
