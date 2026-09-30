import { execSync } from "node:child_process";

/**
 * Apply the real migrations (incl. append-only triggers) to the dedicated test
 * database. Non-destructive: `migrate deploy` only applies pending migrations.
 * Tests then clear rows with TRUNCATE via tests/helpers.ts#resetDb, which refuses
 * to run against any database whose name does not end in "_test".
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://omsapp:omsapp@localhost:5432/oms_test?schema=public";
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
