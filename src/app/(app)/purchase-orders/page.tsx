import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { syncGmailNowAction, retryGmailMessageAction } from "@/server/actions/admin";
import { formatDateTime, formatRelative, cn } from "@/lib/utils";
import { env } from "@/lib/env";

export const metadata = { title: "Purchase Orders" };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  const { tab = "review" } = await searchParams;
  const [queue, gmail, log, recent] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ["PO_RECEIVED", "PO_UNDER_REVIEW"] } },
      orderBy: { createdAt: "desc" },
      include: { customer: true, purchaseOrders: { orderBy: { createdAt: "asc" }, take: 1 }, _count: { select: { documents: true } } },
    }),
    prisma.gmailConnection.findUnique({ where: { id: "primary" } }),
    tab === "log" ? prisma.gmailProcessedMessage.findMany({ orderBy: { processedAt: "desc" }, take: 100 }) : Promise.resolve([]),
    tab === "all"
      ? prisma.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { order: { include: { customer: true } } } })
      : Promise.resolve([]),
  ]);

  const tabs = [
    { key: "review", label: `Requires review (${queue.length})` },
    { key: "all", label: "All imported POs" },
    { key: "log", label: "Gmail import log" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description="Gmail → Extract PO → Duplicate check → Draft order → Admin review → Order created"
        actions={
          <>
            {gmail && (
              <ActionButton run={syncGmailNowAction} variant="secondary">
                <RefreshCw /> Check Gmail now
              </ActionButton>
            )}
            <Link href="/orders/new" className={buttonVariants()}>
              <Plus /> Manual order
            </Link>
          </>
        }
      />

      {!gmail ? (
        <Alert tone="info" title="Gmail is not connected">
          Connect the company PO mailbox in <Link href="/settings?tab=gmail">Settings → Gmail</Link> to import purchase orders automatically.
        </Alert>
      ) : gmail.status === "ERROR" ? (
        <Alert tone="danger" title={gmail.lastError ?? "Gmail connection lost. Please reconnect."}>
          <Link href="/settings?tab=gmail">Reconnect Gmail</Link>
        </Alert>
      ) : (
        <p className="text-xs text-muted">
          Connected to <span className="font-medium text-foreground">{gmail.email}</span> · last checked {formatRelative(gmail.lastSyncAt)} · polling every {env().GMAIL_POLL_INTERVAL_MINUTES} min
          {gmail.watchExpiration && gmail.watchExpiration > new Date() ? " · push notifications active" : ""}
        </p>
      )}

      <nav className="flex gap-1 border-b border-border" aria-label="Tabs">
        {tabs.map((t) => (
          <Link key={t.key} href={`/purchase-orders?tab=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary font-medium" : "border-transparent text-muted hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "review" && (
        <Card>
          {queue.length === 0 ? (
            <EmptyState title="No POs waiting for review." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>From</Th>
                  <Th>PO number</Th>
                  <Th>Customer</Th>
                  <Th>Machine</Th>
                  <Th>Extraction</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => {
                  const po = o.purchaseOrders[0];
                  return (
                    <tr key={o.id} className="hover:bg-surface-2/60">
                      <Td className="whitespace-nowrap">{formatDateTime(po?.receivedAt ?? o.createdAt)}</Td>
                      <Td className="max-w-56">
                        <div className="truncate">{po?.senderEmail ?? (po?.source === "MANUAL" ? "Manual" : "—")}</div>
                        <div className="truncate text-xs text-muted">{po?.subject}</div>
                      </Td>
                      <Td className="whitespace-nowrap font-medium">{o.poNumber ?? <span className="text-subtle">not found</span>}</Td>
                      <Td>{o.customer?.name ?? <span className="text-subtle">not matched</span>}</Td>
                      <Td className="max-w-48 truncate">{o.machineName ?? "—"}</Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={po?.extractionStatus === "SUCCESS" ? "success" : po?.extractionStatus === "FAILED" ? "danger" : "warning"}>{po?.extractionStatus ?? "—"}</Badge>
                          {po?.duplicateStatus === "SUSPECTED" && <Badge tone="danger">Possible duplicate</Badge>}
                          {!!po?.extractionWarnings.length && <span className="text-xs text-muted">{po.extractionWarnings.length} warning(s)</span>}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={o.status} />
                      </Td>
                      <Td className="text-right">
                        <Link href={`/purchase-orders/${o.id}`} className={buttonVariants({ size: "sm" })}>
                          Review
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "all" && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Source</Th>
                <Th>Subject / sender</Th>
                <Th>Order</Th>
                <Th>Extraction</Th>
                <Th>Duplicate check</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(p.receivedAt ?? p.createdAt)}</Td>
                  <Td>{p.source === "GMAIL" ? "Gmail" : "Manual"}</Td>
                  <Td className="max-w-72">
                    <div className="truncate">{p.subject ?? "—"}</div>
                    <div className="truncate text-xs text-muted">{p.senderEmail}</div>
                  </Td>
                  <Td>
                    <Link className="text-accent hover:underline" href={`/orders/${p.orderId}`}>
                      {p.order.orderNumber ?? "Draft"}
                    </Link>
                    <div className="text-xs text-muted">{p.order.customer?.name}</div>
                  </Td>
                  <Td>
                    <Badge tone={p.extractionStatus === "SUCCESS" ? "success" : p.extractionStatus === "FAILED" ? "danger" : p.extractionStatus === "MANUAL" ? "muted" : "warning"}>{p.extractionStatus}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={p.duplicateStatus === "NONE" ? "muted" : p.duplicateStatus === "SUSPECTED" ? "danger" : "info"}>{p.duplicateStatus}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "log" && (
        <Card>
          <CardHeader>
            <CardTitle>Every Gmail message examined (each is processed exactly once)</CardTitle>
          </CardHeader>
          {log.length === 0 ? (
            <EmptyState title="No messages processed yet." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Processed</Th>
                  <Th>Gmail message ID</Th>
                  <Th>Result</Th>
                  <Th>Details</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {log.map((m) => (
                  <tr key={m.messageId}>
                    <Td className="whitespace-nowrap">{formatDateTime(m.processedAt)}</Td>
                    <Td className="font-mono text-xs">{m.messageId}</Td>
                    <Td>
                      <Badge tone={m.result === "IMPORTED" ? "success" : m.result === "ERROR" ? "danger" : "muted"}>{m.result}</Badge>
                    </Td>
                    <Td className="max-w-md text-xs text-muted">{m.reason ?? "—"}</Td>
                    <Td className="text-right">
                      {(m.result === "ERROR" || m.result === "SKIPPED") && (
                        <ActionButton size="sm" variant="secondary" run={retryGmailMessageAction.bind(null, m.messageId)}>
                          Retry
                        </ActionButton>
                      )}
                    </Td>
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
