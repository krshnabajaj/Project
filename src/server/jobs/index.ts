import { syncGmail, renewGmailWatch } from "../integrations/gmail/sync";
import { retryFailedNotifications } from "../services/notifications";
import { runOverdueCheck } from "../services/overdue";
import { systemLog, errorMessage } from "../system-log";
import { withLease } from "./lease";

/** Background jobs. Run by `npm run worker` and/or the /api/cron/[job] endpoints. */
type Job = { run: () => Promise<unknown>; leaseMs: number };

export const JOBS: Record<"gmail-poll" | "notification-retry" | "overdue-check" | "gmail-watch", Job> = {
  "gmail-poll": { run: () => syncGmail(), leaseMs: 10 * 60_000 },
  "notification-retry": { run: () => retryFailedNotifications(), leaseMs: 5 * 60_000 },
  "overdue-check": { run: () => runOverdueCheck(), leaseMs: 5 * 60_000 },
  "gmail-watch": { run: () => renewGmailWatch(), leaseMs: 5 * 60_000 },
};

export type JobName = keyof typeof JOBS;

export function isJobName(name: string): name is JobName {
  return name in JOBS;
}

export async function runJob(name: JobName) {
  const job = JOBS[name];
  const started = Date.now();
  try {
    // gmail-poll manages its own lease; others are wrapped here.
    const result = name === "gmail-poll" ? await job.run() : await withLease<unknown>(`job:${name}`, job.leaseMs, job.run);
    return { ok: true as const, job: name, ms: Date.now() - started, result: result ?? { skipped: "already running" } };
  } catch (err) {
    await systemLog("ERROR", `job:${name}`, `Job failed: ${errorMessage(err)}`);
    return { ok: false as const, job: name, ms: Date.now() - started, error: errorMessage(err) };
  }
}
