import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { CustomerDialog } from "@/components/admin/customer-dialog";
import { saveCustomerAction } from "@/server/actions/admin";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q } = await searchParams;
  const customers = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { contactPerson: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { name: "asc" },
    include: { _count: { select: { orders: true } }, orders: { where: { status: { notIn: ["DISPATCHED", "CLOSED", "CANCELLED"] } }, select: { id: true } } },
  });
  return (
    <div>
      <PageHeader title="Customers" description="Incoming POs are matched to customers by email domain or exact name." actions={<CustomerDialog action={saveCustomerAction.bind(null, null)} trigger="Add customer" isNew />} />
      <form className="mb-3 max-w-sm">
        <input name="q" defaultValue={q} placeholder="Search customers…" className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm" aria-label="Search customers" />
      </form>
      <Card>
        {customers.length === 0 ? (
          <EmptyState title="No customers found." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Contact</Th>
                <Th>Email domain match</Th>
                <Th className="text-right">Open orders</Th>
                <Th className="text-right">Total orders</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <div className="font-medium">{c.name}</div>
                    <div className="max-w-72 truncate text-xs text-muted">{c.billingAddress}</div>
                    {c.isDemo && <Badge tone="muted">Demo</Badge>}
                  </Td>
                  <Td className="text-sm">
                    {c.contactPerson ?? "—"}
                    <div className="text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td className="text-xs text-muted">{c.emailDomain ?? "—"}</Td>
                  <Td className="tabular text-right">{c.orders.length}</Td>
                  <Td className="tabular text-right">
                    <Link className="text-accent hover:underline" href={`/orders?customer=${c.id}&status=all`}>
                      {c._count.orders}
                    </Link>
                  </Td>
                  <Td className="text-right">
                    <CustomerDialog action={saveCustomerAction.bind(null, c.id)} trigger="Edit" values={c} />
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
