import { OAuth2Client } from "google-auth-library";
import { gmail as gmailFactory, type gmail_v1 } from "@googleapis/gmail";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { Actor } from "../../actor";
import { audit, AUDIT } from "../../audit";
import { systemLog, errorMessage } from "../../system-log";

/**
 * gmail.readonly — read PO emails and attachments
 * gmail.send     — optional outgoing completion emails via the same mailbox (EMAIL_PROVIDER=gmail)
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export const GMAIL_LOST_MESSAGE = "Gmail connection lost. Please reconnect.";

export function gmailOAuthConfigured() {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI && e.ENCRYPTION_KEY);
}

export function oauthClient(): OAuth2Client {
  const e = env();
  if (!gmailOAuthConfigured()) {
    throw new AppError(
      "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and ENCRYPTION_KEY.",
      "INTEGRATION",
    );
  }
  return new OAuth2Client({
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: e.GOOGLE_REDIRECT_URI,
  });
}

export function buildAuthUrl(state: string) {
  const e = env();
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // guarantees a refresh token on reconnect
    scope: GMAIL_SCOPES,
    state,
    login_hint: e.GMAIL_USER,
    include_granted_scopes: true,
  });
}

/** Exchange the OAuth code and persist the (encrypted) tokens for the company mailbox. */
export async function completeOAuth(code: string, actor: Actor) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new AppError("Google did not return a refresh token. Remove the app from your Google account permissions and reconnect.", "INTEGRATION");
  }
  client.setCredentials(tokens);
  const gmail = gmailFactory({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress ?? "unknown";
  const expected = env().GMAIL_USER;
  if (expected && expected.toLowerCase() !== email.toLowerCase()) {
    throw new AppError(`Connected account ${email} does not match GMAIL_USER (${expected}). Please sign in with the company PO mailbox.`, "VALIDATION");
  }

  await prisma.$transaction(async (tx) => {
    await tx.gmailConnection.upsert({
      where: { id: "primary" },
      create: {
        id: "primary",
        email,
        encryptedRefreshToken: encrypt(tokens.refresh_token!),
        encryptedAccessToken: tokens.access_token ? encrypt(tokens.access_token) : null,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ?? GMAIL_SCOPES.join(" "),
        historyId: profile.data.historyId ?? null,
        status: "CONNECTED",
        connectedById: actor.id,
      },
      update: {
        email,
        encryptedRefreshToken: encrypt(tokens.refresh_token!),
        encryptedAccessToken: tokens.access_token ? encrypt(tokens.access_token) : null,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ?? GMAIL_SCOPES.join(" "),
        status: "CONNECTED",
        lastError: null,
        connectedById: actor.id,
      },
    });
    await audit(tx, actor, {
      action: AUDIT.GMAIL_CONNECTED,
      summary: `${actor.name} connected Gmail account ${email}`,
      entityType: "gmail",
      entityId: "primary",
    });
  });
  await systemLog("INFO", "gmail", `Gmail account ${email} connected`);
  return email;
}

export async function disconnectGmail(actor: Actor) {
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "primary" } });
  if (!conn) return;
  try {
    await oauthClient().revokeToken(decrypt(conn.encryptedRefreshToken));
  } catch (err) {
    await systemLog("WARN", "gmail", `Token revocation failed (continuing disconnect): ${errorMessage(err)}`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.gmailConnection.delete({ where: { id: "primary" } });
    await audit(tx, actor, {
      action: AUDIT.GMAIL_DISCONNECTED,
      summary: `${actor.name} disconnected Gmail account ${conn.email}`,
      entityType: "gmail",
      entityId: "primary",
    });
  });
}

/** Mark the connection broken and alert admins (never fail silently). */
export async function markGmailError(message: string) {
  await prisma.gmailConnection.updateMany({ where: { id: "primary" }, data: { status: "ERROR", lastError: message } });
  await systemLog("ERROR", "gmail", message);
  const { notifyAdminsInApp } = await import("../../services/notifications");
  await notifyAdminsInApp({
    type: "GMAIL_ERROR",
    title: "Gmail connection problem",
    message,
    link: "/settings?tab=gmail",
    dedupeMinutes: 60,
  });
}

export function isAuthError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
  return msg.includes("invalid_grant") || msg.includes("unauthorized_client") || status === 401 || msg.includes("token has been expired or revoked");
}

/** Authorized Gmail API client for the connected mailbox. Persists refreshed access tokens. */
export async function gmailApiClient(): Promise<{ gmail: gmail_v1.Gmail; email: string }> {
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "primary" } });
  if (!conn) throw new AppError("Gmail is not connected. Connect the PO mailbox in Settings → Gmail.", "INTEGRATION");
  const client = oauthClient();
  client.setCredentials({
    refresh_token: decrypt(conn.encryptedRefreshToken),
    access_token: conn.encryptedAccessToken ? decrypt(conn.encryptedAccessToken) : undefined,
    expiry_date: conn.accessTokenExpiresAt?.getTime(),
  });
  client.on("tokens", (tokens) => {
    void prisma.gmailConnection
      .update({
        where: { id: "primary" },
        data: {
          encryptedAccessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
          encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
        },
      })
      .catch((err) => systemLog("WARN", "gmail", `Could not persist refreshed token: ${errorMessage(err)}`));
  });
  return { gmail: gmailFactory({ version: "v1", auth: client }), email: conn.email };
}
