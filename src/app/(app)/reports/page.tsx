import { Download } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { reportData } from "@/server/services/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Table, Td, Th, EmptyState } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { statusLabel } from "@/lib/status";

export const metadata = { title: "Reports" };

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  if (!rows.length) return <EmptyState title="No data for this period." />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_2.5rem] items-center gap-3 text-sm" title={`${r.label}: ${r.value}`}>
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded-sm bg-bar-track">
            <span className="block h-full rounded-sm bg-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-medium">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdmin();
  const { from, to } = await searchParams;
  const data = await reportData(from, to);
  const qs = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v) as [string, string][]).toString();
  const exp = (report: string, format: string) => `/api/export/orders?report=${report}&format=${format}&status=all${qs ? `&${qs}` : ""}`;
  const p = data.production;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={`${data.orders.length} order(s) created ${from || to ? `between ${from ?? "…"} and ${to ?? "…"}` : "in total"} (cancelled excluded)`}
        actions={
          <>
            <a href={exp("summary", "xlsx")} className={buttonVariants({ variant: "secondary" })}>
              <Download /> Summary (Excel)
            </a>
            <a href={exp("orders", "csv")} className={buttonVariants({ variant: "secondary" })}>
              <Download /> Orders (CSV)
            </a>
            <a href={exp("orders", "xlsx")} className={buttonVariants({ variant: "secondary" })}>
              <Download /> Orders (Excel)
            </a>
          </>
        }
      />
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          Created from
          <Input type="date" name="from" defaultValue={from} className="mt-1 w-auto" />
        </label>
        <label className="text-xs text-muted">
          to
          <Input type="date" name="to" defaultValue={to} className="mt-1 w-auto" />
        </label>
        <button className={buttonVariants({ variant: "primary" })}>Apply</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Production</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ["Machines completed", p.completed],
            ["In assembly", p.inAssembly],
            ["Awaiting / in testing", p.testing],
            ["Awaiting photos", p.awaitingPhotos],
            ["Packed", p.packed],
            ["Ready for dispatch", p.readyForDispatch],
            ["Dispatched", p.dispatched],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md border border-border p-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="tabular text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={data.byStatus.map((r) => ({ label: statusLabel(r.status), value: r.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders by customer</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={data.byCustomer.slice(0, 12).map((r) => ({ label: r.name, value: r.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders by month</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars rows={data.byMonth.map((r) => ({ label: r.month, value: r.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Engineer performance</CardTitle>
          </CardHeader>
          {data.engineers.length === 0 ? (
            <EmptyState title="No assigned orders in this period." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Engineer</Th>
                  <Th className="text-right">Assigned</Th>
                  <Th className="text-right">Completed</Th>
                  <Th className="text-right">Avg. completion</Th>
                  <Th className="text-right">Overdue</Th>
                </tr>
              </thead>
              <tbody>
                {data.engineers.map((e) => (
                  <tr key={e.name}>
                    <Td>{e.name}</Td>
                    <Td className="tabular text-right">{e.assigned}</Td>
                    <Td className="tabular text-right">{e.completed}</Td>
                    <Td className="tabular text-right">{e.avgDays === null ? "—" : `${e.avgDays} days`}</Td>
                    <Td className={`tabular text-right ${e.overdue ? "font-semibold text-[var(--tone-danger-fg)]" : ""}`}>{e.overdue}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
