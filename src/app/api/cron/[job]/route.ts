import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { isJobName, runJob } from "@/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduler entry point for serverless deployments (Vercel Cron, Cloud Scheduler, cron + curl):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/gmail-poll
 * Jobs: gmail-poll | notification-retry | overdue-check | gmail-watch
 */
async function handle(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { job } = await params;
  if (!isJobName(job)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  const res = await runJob(job);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}

export { handle as GET, handle as POST };
