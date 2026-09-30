import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, Alert } from "@/components/ui/misc";
import { OrderForm } from "@/components/orders/order-form";
import { updateOrderAction } from "@/server/actions/orders";
import { canPerform } from "@/lib/workflow";
import { orderFormValues } from "@/components/orders/form-values";

export const metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) notFound();
  const customers = await prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-5xl">
      <Link href={`/orders/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeft className="size-4" /> {order.orderNumber ?? "Order"}
      </Link>
      <PageHeader title={`Edit ${order.orderNumber ?? "order"}`} description="Every change is recorded in the audit trail with previous and new values." />
      {!canPerform("EDIT", "ADMIN", order.status) ? (
        <Alert tone="warning">This order can no longer be edited.</Alert>
      ) : (
        <Card>
          <CardContent>
            <OrderForm action={updateOrderAction.bind(null, id)} customers={customers} values={orderFormValues(order)} submitLabel="Save changes" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
