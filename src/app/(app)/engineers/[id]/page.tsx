import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { listOrders, engineerWorkload } from "@/server/services/queries";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { OrderTable } from "@/components/orders/order-table";

export const metadata = { title: "Engineer" };

export default async function EngineerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const engineer = await prisma.user.findUnique({ where: { id } });
  if (!engineer || engineer.role !== "ENGINEER") notFound();
  const [open, done, stats] = await Promise.all([
    listOrders({ engineerId: id, status: "open", sort: sp.sort ?? "expected", dir: sp.dir === "desc" ? "desc" : "asc", pageSize: 200 }, user),
    listOrders({ engineerId: id, status: "all", sort: "lastUpdate", dir: "desc", pageSize: 200 }, user),
    engineerWorkload(),
  ]);
  const s = stats.find((x) => x.id === id);
  const history = done.rows.filter((o) => ["DISPATCHED", "CLOSED", "CANCELLED"].includes(o.status));
  return (
    <div className="space-y-5">
      <Link href="/engineers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeft className="size-4" /> Engineers
      </Link>
      <PageHeader
        title={engineer.name}
        description={`${engineer.email}${engineer.phone ? ` · ${engineer.phone}` : ""} · ${s?.assigned ?? 0} assigned · ${s?.inProgress ?? 0} in progress · ${s?.completed ?? 0} completed · ${s?.overdue ?? 0} overdue`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Open orders ({open.rows.length})</CardTitle>
        </CardHeader>
        <OrderTable rows={open.rows} today={open.today} searchParams={sp} basePath={`/engineers/${id}`} />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Dispatched / closed ({history.length})</CardTitle>
        </CardHeader>
        <OrderTable rows={history} today={open.today} searchParams={{}} basePath={`/engineers/${id}`} />
      </Card>
    </div>
  );
}
