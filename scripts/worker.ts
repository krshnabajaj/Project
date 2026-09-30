/**
 * Background worker — keeps Gmail import, notification retries and overdue
 * alerts running independently of anyone having the app open.
 *
 *   npm run worker
 *
 * Run exactly one or more instances next to the web app (jobs use DB leases,
 * so multiple workers never double-process). On serverless hosts use the
 * /api/cron/<job> endpoints with a scheduler instead.
 */
import { runJob, type JobName } from "../src/server/jobs";
import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

const minutes = (n: number) => n * 60_000;

const schedule: { job: JobName; everyMs: number }[] = [
  { job: "gmail-poll", everyMs: minutes(env().GMAIL_POLL_INTERVAL_MINUTES) },
  { job: "notification-retry", everyMs: minutes(2) },
  { job: "overdue-check", everyMs: minutes(60) },
  { job: "gmail-watch", everyMs: minutes(12 * 60) },
];

let stopping = false;
const timers: NodeJS.Timeout[] = [];

async function tick(job: JobName) {
  if (stopping) return;
  const res = await runJob(job);
  const line = res.ok ? `ok (${res.ms}ms) ${JSON.stringify(res.result)}` : `FAILED: ${res.error}`;
  console.log(`[worker] ${new Date().toISOString()} ${job}: ${line}`);
}

async function main() {
  console.log(`[worker] starting — Gmail poll every ${env().GMAIL_POLL_INTERVAL_MINUTES} min`);
  for (const { job, everyMs } of schedule) {
    await tick(job);
    timers.push(setInterval(() => void tick(job), everyMs));
  }
}

async function shutdown() {
  stopping = true;
  timers.forEach(clearInterval);
  await prisma.$disconnect();
  console.log("[worker] stopped");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
