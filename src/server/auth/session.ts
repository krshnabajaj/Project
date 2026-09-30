import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { authOptions } from "./options";
import type { Actor } from "../actor";

export interface SessionUser extends Actor {
  id: string;
  role: "ADMIN" | "ENGINEER";
  email: string;
}

/**
 * Resolve the signed-in user. The JWT is only trusted for identity: role and
 * active flag are re-read from the database on every request so that
 * deactivating an engineer or changing a role takes effect immediately.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) return null;
  const h = await headers();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
}

/** For pages: redirect to login when signed out, to home when role is wrong. */
export async function requireUser(role?: "ADMIN" | "ENGINEER"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect(user.role === "ADMIN" ? "/dashboard" : "/my-orders");
  return user;
}

export const requireAdmin = () => requireUser("ADMIN");

/** For server actions / route handlers: throw instead of redirecting. */
export async function authorize(role?: "ADMIN" | "ENGINEER"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  if (role && user.role !== role) throw new AppError("You are not allowed to perform this action.", "FORBIDDEN");
  return user;
}
