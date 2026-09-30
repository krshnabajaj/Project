import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/server/auth/session";
import { buildAuthUrl, gmailOAuthConfigured } from "@/server/integrations/gmail/oauth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Admin starts the Google OAuth consent flow for the company PO mailbox. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/login", env().APP_URL));
  if (!gmailOAuthConfigured()) {
    return NextResponse.redirect(new URL("/settings?tab=gmail&gmail=not-configured", env().APP_URL));
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/gmail",
  });
  return res;
}
