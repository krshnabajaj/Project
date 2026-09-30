import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { verifyPassword, DUMMY_HASH } from "./password";
import { auditNow, AUDIT } from "../audit";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

const SESSION_MAX_AGE = 12 * 60 * 60; // one working day

function clientIp(headers: Record<string, unknown> | undefined): string {
  const fwd = headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : typeof fwd === "string" ? fwd : "";
  return raw.split(",")[0]?.trim() || "unknown";
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  jwt: { maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, req) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(req?.headers as Record<string, unknown> | undefined);

        // Brute-force protection: per account and per IP.
        const byAccount = rateLimit(`login:acct:${email}`, 8, 15 * 60 * 1000);
        const byIp = rateLimit(`login:ip:${ip}`, 40, 15 * 60 * 1000);
        if (!byAccount.ok || !byIp.ok) {
          throw new Error("Too many login attempts. Please wait 15 minutes and try again.");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok || !user.active) {
          await auditNow(
            { id: null, name: email, role: "SYSTEM", ip },
            {
              action: AUDIT.USER_LOGIN_FAILED,
              summary: `Failed login for ${email}${user && !user.active ? " (account deactivated)" : ""}`,
              entityType: "user",
              entityId: user?.id,
            },
          );
          return null;
        }
        resetRateLimit(`login:acct:${email}`);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await auditNow(
          { id: user.id, name: user.name, role: user.role, ip },
          { action: AUDIT.USER_LOGIN, summary: `${user.name} logged in`, entityType: "user", entityId: user.id },
        );
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role?: "ADMIN" | "ENGINEER" }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as "ADMIN" | "ENGINEER";
      }
      return session;
    },
  },
};
