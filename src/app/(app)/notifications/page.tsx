import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { ActionButton } from "@/components/ui/action-form";
import { RetryButton } from "@/components/orders/order-actions";
import { markNotificationsReadAction, markNotificationUnreadAction } from "@/server/actions/admin";
import { retryNotificationAction } from "@/server/actions/orders";
import { formatDateTime, cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  const user = await requireUser();
  const { tab = "inbox", filter = "all" } = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const [items, outbox] = await Promise.all([
    prisma.inAppNotification.findMany({
      where: { userId: user.id, ...(filter === "unread" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    isAdmin && tab === "outbox"
      ? prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { order: { select: { orderNumber: true, id: true } } } })
      : Promise.resolve([]),
  ]);
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        actions={
          tab === "inbox" && unread > 0 ? (
            <ActionButton variant="secondary" run={markNotificationsReadAction.bind(null, "all")}>
              Mark all read
            </ActionButton>
          ) : null
        }
      />
      <nav className="flex gap-1 border-b border-border">
        {[
          { key: "inbox", label: "In-app" },
          ...(isAdmin ? [{ key: "outbox", label: "WhatsApp & email delivery log" }] : []),
        ].map((t) => (
          <Link key={t.key} href={`/notifications?tab=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary font-medium" : "border-transparent text-muted")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "inbox" && (
        <>
          <div className="flex gap-2 text-sm">
            <Link href="/notifications?filter=all" className={filter === "all" ? "font-semibold" : "text-muted"}>
              All
            </Link>
            <Link href="/notifications?filter=unread" className={filter === "unread" ? "font-semibold" : "text-muted"}>
              Unread ({unread})
            </Link>
          </div>
          <Card>
            {items.length === 0 ? (
              <EmptyState title="No notifications." />
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.readAt && "bg-[var(--tone-info-bg)]/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? "Read" : "Unread"} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</div>
                      <div className="text-sm text-muted">{n.message}</div>
                      <div className="mt-0.5 text-xs text-subtle">{formatDateTime(n.createdAt)}</div>
                    </div>
                    {n.readAt ? (
                      <ActionButton size="sm" variant="ghost" run={markNotificationUnreadAction.bind(null, n.id)}>
                        Mark unread
                      </ActionButton>
                    ) : (
                      <ActionButton size="sm" variant="ghost" run={markNotificationsReadAction.bind(null, [n.id])}>
                        Mark read
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === "outbox" && isAdmin && (
        <Card>
          {outbox.length === 0 ? (
            <EmptyState title="Nothing sent yet." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Channel</Th>
                  <Th>Type</Th>
                  <Th>Order</Th>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th>Details</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {outbox.map((n) => (
                  <tr key={n.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(n.createdAt)}</Td>
                    <Td>{n.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</Td>
                    <Td className="text-xs">{n.type}</Td>
                    <Td>
                      {n.order ? (
                        <Link href={`/orders/${n.order.id}`} className="text-accent hover:underline">
                          {n.order.orderNumber ?? "Draft"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-xs">{n.recipient}</Td>
                    <Td>
                      <Badge tone={n.status === "SENT" ? "success" : n.status === "FAILED" ? "danger" : n.status === "SKIPPED" ? "warning" : "info"}>{n.status}</Badge>
                      <div className="text-[11px] text-subtle">{n.attempts} attempt(s)</div>
                    </Td>
                    <Td className="max-w-md text-xs">
                      <div className="line-clamp-2 whitespace-pre-line text-muted" title={n.message}>
                        {n.subject ?? n.message}
                      </div>
                      {n.error && <div className="mt-1 text-[var(--tone-danger-fg)]">{n.error}</div>}
                    </Td>
                    <Td>{(n.status === "FAILED" || n.status === "SKIPPED") && <RetryButton run={retryNotificationAction.bind(null, n.id, n.orderId ?? undefined)} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
