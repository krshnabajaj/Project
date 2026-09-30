import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { ActionButton } from "@/components/ui/action-form";
import { runOverdueCheckAction } from "@/server/actions/admin";
import { formatDateTime, cn } from "@/lib/utils";

export const metadata = { title: "System logs" };

export default async function SystemLogsPage({ searchParams }: { searchParams: Promise<{ level?: string; source?: string }> }) {
  await requireAdmin();
  const { level, source } = await searchParams;
  const [logs, sources, pending, failed] = await Promise.all([
    prisma.systemLog.findMany({
      where: { ...(level ? { level: level as "INFO" | "WARN" | "ERROR" } : {}), ...(source ? { source } : {}) },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.systemLog.findMany({ distinct: ["source"], select: { source: true }, orderBy: { source: "asc" } }),
    prisma.notification.count({ where: { status: "PENDING" } }),
    prisma.notification.count({ where: { status: "FAILED" } }),
  ]);
  const href = (l?: string, s?: string) => `/system-logs?${new URLSearchParams(Object.entries({ level: l, source: s }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <div className="space-y-4">
      <PageHeader
        title="System logs"
        description={`Integration and background-job events. Outbox: ${pending} pending, ${failed} failed (see Notifications → delivery log).`}
        actions={
          <ActionButton variant="secondary" run={runOverdueCheckAction}>
            Run overdue check now
          </ActionButton>
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        {[undefined, "ERROR", "WARN", "INFO"].map((l) => (
          <Link key={l ?? "all"} href={href(l, source)} className={cn("rounded-full border px-3 py-1", level === l ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
            {l ?? "All levels"}
          </Link>
        ))}
        <span className="mx-2 border-l border-border" />
        {sources.map((s) => (
          <Link key={s.source} href={href(level, source === s.source ? undefined : s.source)} className={cn("rounded-full border px-3 py-1", source === s.source ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
            {s.source}
          </Link>
        ))}
      </div>
      <Card>
        {logs.length === 0 ? (
          <EmptyState title="No log entries." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Level</Th>
                <Th>Source</Th>
                <Th>Message</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="align-top">
                  <Td className="tabular whitespace-nowrap">{formatDateTime(l.createdAt)}</Td>
                  <Td>
                    <Badge tone={l.level === "ERROR" ? "danger" : l.level === "WARN" ? "warning" : "muted"}>{l.level}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{l.source}</Td>
                  <Td className="text-sm">
                    {l.message}
                    {l.context ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted">context</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px]">{JSON.stringify(l.context, null, 2)}</pre>
                      </details>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
