import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { PackDialog, DispatchDialog, StepButton } from "@/components/orders/order-actions";
import { markPackedAction, markReadyAction, markDispatchedAction } from "@/server/actions/orders";
import { formatDate, formatDateTime, todayIso } from "@/lib/utils";

export const metadata = { title: "Dispatch" };

const SECTIONS = [
  { title: "Machine completed — awaiting photos", statuses: ["COMPLETED"] },
  { title: "Ready to pack", statuses: ["PHOTOS_UPLOADED"] },
  { title: "Packed", statuses: ["PACKED"] },
  { title: "Ready for dispatch", statuses: ["READY_FOR_DISPATCH"] },
] as const;

export default async function DispatchPage() {
  const user = await requireAdmin();
  const today = todayIso();
  const [orders, recent] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ["COMPLETED", "PHOTOS_UPLOADED", "PACKED", "READY_FOR_DISPATCH"] } },
      include: { customer: true, engineer: true, dispatch: true, _count: { select: { images: { where: { kind: "MACHINE" } } } } },
      orderBy: { completedAt: "asc" },
    }),
    prisma.order.findMany({
      where: { status: { in: ["DISPATCHED", "CLOSED"] } },
      include: { customer: true, dispatch: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Packing & dispatch" description="Orders stay on the dashboard until they are dispatched." />
      {SECTIONS.map((s) => {
        const rows = orders.filter((o) => (s.statuses as readonly string[]).includes(o.status));
        return (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle>
                {s.title} ({rows.length})
              </CardTitle>
            </CardHeader>
            {rows.length === 0 ? (
              <EmptyState title="None." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Customer</Th>
                    <Th>Machine</Th>
                    <Th>Engineer</Th>
                    <Th>Completed</Th>
                    <Th>Photos</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <Td>
                        <Link href={`/orders/${o.id}`} className="font-semibold text-accent hover:underline">
                          {o.orderNumber}
                        </Link>
                        <div className="text-xs text-muted">PO {o.poNumber}</div>
                      </Td>
                      <Td>{o.customer?.name}</Td>
                      <Td className="max-w-48 truncate">{o.machineName}</Td>
                      <Td>{o.engineer?.name}</Td>
                      <Td className="whitespace-nowrap">{formatDateTime(o.completedAt)}</Td>
                      <Td className="tabular">{o._count.images}/8</Td>
                      <Td>
                        <StatusBadge status={o.status} />
                        {o.dispatch?.packedAt && <div className="mt-1 text-xs text-muted">Packed {formatDateTime(o.dispatch.packedAt)}</div>}
                      </Td>
                      <Td className="text-right">
                        {o.status === "PHOTOS_UPLOADED" && <PackDialog action={markPackedAction.bind(null, o.id)} adminName={user.name} />}
                        {o.status === "PACKED" && (
                          <StepButton action={markReadyAction.bind(null, o.id)} confirm={`Mark ${o.orderNumber} READY FOR DISPATCH?`}>
                            Ready for dispatch
                          </StepButton>
                        )}
                        {o.status === "READY_FOR_DISPATCH" && <DispatchDialog action={markDispatchedAction.bind(null, o.id)} today={today} />}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        );
      })}
      <Card>
        <CardHeader>
          <CardTitle>Recently dispatched</CardTitle>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState title="Nothing dispatched yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Dispatched</Th>
                <Th>Courier / transporter</Th>
                <Th>AWB / LR</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/orders/${o.id}`} className="font-semibold text-accent hover:underline">
                      {o.orderNumber}
                    </Link>
                  </Td>
                  <Td>{o.customer?.name}</Td>
                  <Td>{formatDate(o.dispatch?.dispatchedAt)}</Td>
                  <Td>{[o.dispatch?.courier, o.dispatch?.transporter].filter(Boolean).join(" / ") || "—"}</Td>
                  <Td className="font-mono text-xs">{o.dispatch?.trackingNumber ?? "—"}</Td>
                  <Td>
                    <StatusBadge status={o.status} />
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
