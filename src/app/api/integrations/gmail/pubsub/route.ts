import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";
import { syncGmail } from "@/server/integrations/gmail/sync";
import { systemLog, errorMessage } from "@/server/system-log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const verifier = new OAuth2Client();

/**
 * Gmail push notifications via Cloud Pub/Sub (push subscription with OIDC auth).
 * The payload only says "mailbox changed"; we run the idempotent query-based sync,
 * so a missed or duplicated push is harmless (polling remains the fallback).
 */
export async function POST(req: Request) {
  const e = env();
  if (!e.GMAIL_PUBSUB_AUDIENCE) return NextResponse.json({ error: "Push not configured" }, { status: 404 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience: e.GMAIL_PUBSUB_AUDIENCE });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || (e.GMAIL_PUBSUB_SERVICE_ACCOUNT && payload.email !== e.GMAIL_PUBSUB_SERVICE_ACCOUNT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await syncGmail();
  } catch (err) {
    await systemLog("ERROR", "gmail", `Push-triggered sync failed: ${errorMessage(err)}`);
  }
  // Always ack: failures are logged and polling will retry.
  return NextResponse.json({ ok: true });
}
