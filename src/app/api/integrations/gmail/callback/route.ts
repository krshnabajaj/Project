import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { completeOAuth } from "@/server/integrations/gmail/oauth";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { systemLog, errorMessage } from "@/server/system-log";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?tab=gmail&${q}`, base));
    res.cookies.delete({ name: "gmail_oauth_state", path: "/api/integrations/gmail" });
    return res;
  };
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/login", base));

  const state = req.nextUrl.searchParams.get("state") ?? "";
  const expected = req.cookies.get("gmail_oauth_state")?.value ?? "";
  if (!state || !expected || !safeEqual(state, expected)) return back("gmail=error&reason=state");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return back(`gmail=error&reason=${encodeURIComponent(error)}`);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("gmail=error&reason=missing-code");

  try {
    await completeOAuth(code, user);
    return back("gmail=connected");
  } catch (err) {
    await systemLog("ERROR", "gmail", `OAuth callback failed: ${errorMessage(err)}`);
    const msg = err instanceof AppError ? err.message : "Could not complete Google sign-in.";
    return back(`gmail=error&reason=${encodeURIComponent(msg)}`);
  }
}
