import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { AUDIT } from "@/server/audit";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Audit trail" };

const PAGE = 100;

function short(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; user?: string; q?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.user ? { userId: sp.user } : {}),
    ...(sp.q ? { OR: [{ summary: { contains: sp.q, mode: "insensitive" } }, { order: { orderNumber: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { order: { select: { id: true, orderNumber: true } } } }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const qs = (p: number) => new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) }).toString();

  return (
    <div className="space-y-4">
      <PageHeader title="Audit trail" description={`${total} record(s). Audit records are append-only and cannot be edited or deleted — enforced by the database.`} />
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Search text or order number…" className="w-64" />
        <Select name="action" defaultValue={sp.action ?? ""} className="w-auto">
          <option value="">All actions</option>
          {Object.values(AUDIT).map((a) => (
            <option key={a} value={a}>
              {a.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </Select>
        <Select name="user" defaultValue={sp.user ?? ""} className="w-auto">
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <button className={buttonVariants()}>Filter</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No audit records match." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date / time</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Order</Th>
                <Th>Summary</Th>
                <Th>Change</Th>
                <Th>IP / device</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td className="tabular whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    {a.userName ?? "—"}
                    <div className="text-[11px] text-muted">{a.userRole}</div>
                  </Td>
                  <Td>
                    <Badge tone="neutral">{a.action.replaceAll("_", " ")}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {a.order ? (
                      <Link href={`/orders/${a.order.id}`} className="text-accent hover:underline">
                        {a.order.orderNumber ?? "Draft"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="min-w-64">{a.summary}</Td>
                  <Td className="max-w-80 font-mono text-[11px] text-muted">
                    {a.oldValue ? <div>− {short(a.oldValue)}</div> : null}
                    {a.newValue ? <div>+ {short(a.newValue)}</div> : null}
                  </Td>
                  <Td className="max-w-48 text-[11px] text-muted">
                    {a.ipAddress}
                    <div className="truncate" title={a.userAgent ?? ""}>
                      {a.userAgent}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        {page > 1 && (
          <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={`/audit?${qs(page - 1)}`}>
            Previous
          </Link>
        )}
        {page * PAGE < total && (
          <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href={`/audit?${qs(page + 1)}`}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
