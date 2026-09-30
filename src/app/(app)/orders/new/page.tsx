import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { OrderForm } from "@/components/orders/order-form";
import { createOrderAction } from "@/server/actions/orders";

export const metadata = { title: "New order" };

export default async function NewOrderPage() {
  await requireAdmin();
  const customers = await prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Create order manually" description="For POs received outside Gmail (post, WhatsApp, phone). The order number is generated on save; attach the PO document afterwards." />
      <Card>
        <CardContent>
          <OrderForm action={createOrderAction} customers={customers} submitLabel="Create order" />
        </CardContent>
      </Card>
    </div>
  );
}
