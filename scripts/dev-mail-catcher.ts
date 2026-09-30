/**
 * DEVELOPMENT ONLY: a local SMTP server that saves every email it receives as
 * a .eml file (open with any mail client) so completion emails can be checked
 * without real SMTP credentials.
 *   npm run mail:dev      (then set SMTP_HOST=localhost SMTP_PORT=2525)
 */
import { SMTPServer } from "smtp-server";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.MAIL_CATCHER_DIR ?? "./storage/dev-mail");
const port = Number(process.env.MAIL_CATCHER_PORT ?? 2525);
mkdirSync(dir, { recursive: true });

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks);
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.eml`);
      writeFileSync(file, raw);
      const subject = raw.toString("utf8").match(/^Subject: (.*)$/m)?.[1] ?? "(no subject)";
      console.log(`[mail] ${session.envelope.rcptTo.map((r) => r.address).join(", ")} — ${subject} (${Math.round(raw.length / 1024)} KB) → ${file}`);
      cb();
    });
  },
});
server.listen(port, () => console.log(`[mail] dev SMTP catcher listening on :${port}, saving to ${dir}`));
