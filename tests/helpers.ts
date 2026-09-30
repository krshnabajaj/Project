import sharp from "sharp";
import { SMTPServer } from "smtp-server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_STAGES } from "@/server/services/stages";
import { setWhatsAppProvider, type WhatsAppProvider, type WhatsAppMessage } from "@/server/integrations/whatsapp";
import { setEmailTransport } from "@/server/integrations/email";
import type { Actor } from "@/server/actor";
import { resetRateLimit } from "@/lib/rate-limit";

const TABLES = [
  "in_app_notifications", "notifications", "audit_logs", "order_images", "daily_updates", "order_stage_progress",
  "documents", "purchase_orders", "order_notes", "dispatch", "orders", "order_sequences", "customers", "users",
  "assembly_stages", "settings", "gmail_connections", "gmail_processed_messages", "system_logs",
];

/** TRUNCATE bypasses the append-only row triggers — used only to reset the test database. */
export async function resetDb() {
  const db = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!db.endsWith("_test")) throw new Error(`Refusing to reset database "${db}": test databases must end with "_test".`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const PASSWORD = "TestPassword123";

export async function seedBase() {
  await resetDb();
  const passwordHash = await hashPassword(PASSWORD);
  for (const [i, s] of DEFAULT_STAGES.entries()) await prisma.assemblyStage.create({ data: { ...s, sequence: (i + 1) * 10 } });
  const admin = await prisma.user.create({ data: { name: "Admin", email: "admin@test.local", role: "ADMIN", passwordHash, phone: "+919800000001" } });
  const rahul = await prisma.user.create({ data: { name: "Rahul", email: "rahul@test.local", role: "ENGINEER", passwordHash, phone: "+919800000011" } });
  const priya = await prisma.user.create({ data: { name: "Priya", email: "priya@test.local", role: "ENGINEER", passwordHash, phone: "+919800000012" } });
  const customer = await prisma.customer.create({ data: { name: "ABC Hospital", email: "purchase@abchospital.com", emailDomain: "abchospital.com" } });
  const stages = await prisma.assemblyStage.findMany({ orderBy: { sequence: "asc" } });
  const actor = (u: { id: string; name: string; role: "ADMIN" | "ENGINEER" }): Actor => ({ id: u.id, name: u.name, role: u.role, ip: "127.0.0.1" });
  for (const u of ["admin@test.local", "rahul@test.local"]) resetRateLimit(`login:acct:${u}`);
  return {
    admin: actor(admin),
    rahul: actor(rahul),
    priya: actor(priya),
    customer,
    stages,
    stage: (name: string) => stages.find((s) => s.name === name)!,
  };
}

export type Base = Awaited<ReturnType<typeof seedBase>>;

/** Records WhatsApp messages instead of calling Meta/Twilio (the real providers are unit-tested separately). */
export class RecordingWhatsApp implements WhatsAppProvider {
  readonly name = "recording";
  sent: WhatsAppMessage[] = [];
  failNext = false;
  async send(msg: WhatsAppMessage) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated provider outage");
    }
    this.sent.push(msg);
    return { providerMessageId: `wamid.${this.sent.length}` };
  }
}

export function useRecordingWhatsApp() {
  const wa = new RecordingWhatsApp();
  setWhatsAppProvider(wa);
  return wa;
}

export interface CapturedMail {
  to: string[];
  raw: string;
}

/** A real SMTP server on 127.0.0.1:2526 — the app sends through nodemailer exactly as in production. */
export async function startSmtp(port = 2526) {
  setEmailTransport(undefined);
  const mails: CapturedMail[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8") });
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { mails, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function jpeg(label = "photo", w = 800, h = 600): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 110, b: 130 } } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><text x="20" y="60" font-size="40" fill="white">${label}</text></svg>`) }])
    .jpeg()
    .toBuffer();
}

export async function photoFiles(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ name: `machine-${i + 1}.jpg`, type: "image/jpeg", buffer: await jpeg(`p${i + 1}`) });
  return out;
}

/** Build a realistic text-based PO PDF. */
export async function poPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 800;
  for (const line of lines) {
    const cells = line.split("\t");
    let x = 40;
    for (const cell of cells) {
      page.drawText(cell, { x, y, size: 10, font });
      x += Math.max(90, font.widthOfTextAtSize(cell, 10) + 30);
    }
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

export const SAMPLE_PO_LINES = [
  "ABC HOSPITAL PVT LTD",
  "PURCHASE ORDER",
  "PO No: PO-4587\tPO Date: 25-Sep-2026",
  "Bill To:",
  "ABC Hospital Pvt Ltd",
  "12 MG Road, Pune 411001",
  "",
  "Kind Attn: Dr. Meera Shah",
  "Phone: +91 98765 43210",
  "Email: purchase@abchospital.com",
  "Sl\tDescription\tModel\tQty\tRate\tAmount",
  "1\tAutomatic Washer Disinfector\tAWD-500\t2\t4,50,000.00\t9,00,000.00",
  "Delivery Date: 30-Oct-2026",
  "Payment Terms: 30% advance, balance before dispatch",
  "Grand Total: INR 10,62,000.00",
];
