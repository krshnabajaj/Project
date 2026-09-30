/**
 * Production bootstrap: create the first admin account and the default assembly stages.
 *   npm run create-admin -- --email owner@company.com --name "Owner Name"
 * The password is read from ADMIN_INITIAL_PASSWORD or prompted on stdin (never passed as an argument).
 */
import { createInterface } from "node:readline/promises";
import { prisma } from "../src/lib/prisma";
import { hashPassword, passwordSchema } from "../src/server/auth/password";
import { ensureDefaultStages } from "../src/server/services/stages";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!email || !name) throw new Error('Usage: npm run create-admin -- --email you@company.com --name "Your Name"');
  let password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (min 10 chars, letter + number): ");
    rl.close();
  }
  passwordSchema.parse(password);
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`User ${email} already exists.`);
  await ensureDefaultStages();
  await prisma.user.create({ data: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) } });
  console.log(`✔ Admin ${email} created. Default assembly stages ensured.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
