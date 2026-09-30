import { requireUser } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/server/settings";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, recent, company, gmail, reviewCount] = await Promise.all([
    prisma.inAppNotification.count({ where: { userId: user.id, readAt: null } }),
    prisma.inAppNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    getSetting("company"),
    user.role === "ADMIN" ? prisma.gmailConnection.findUnique({ where: { id: "primary" }, select: { status: true, lastError: true } }) : null,
    user.role === "ADMIN" ? prisma.order.count({ where: { status: { in: ["PO_RECEIVED", "PO_UNDER_REVIEW"] } } }) : 0,
  ]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      companyName={company.name}
      unread={unread}
      recent={recent.map((n) => ({ id: n.id, title: n.title, message: n.message, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() }))}
      gmailProblem={gmail?.status === "ERROR" ? gmail.lastError ?? "Gmail connection lost. Please reconnect." : null}
      reviewCount={reviewCount}
    >
      {children}
    </AppShell>
  );
}
