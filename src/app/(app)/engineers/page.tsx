import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { engineerWorkload } from "@/server/services/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { UserDialog, ToggleActive } from "@/components/admin/user-dialog";
import { saveUserAction, setUserActiveAction } from "@/server/actions/admin";
import { formatRelative } from "@/lib/utils";

export const metadata = { title: "Engineers" };

export default async function EngineersPage() {
  await requireAdmin();
  const rows = await engineerWorkload();
  const max = Math.max(1, ...rows.map((r) => r.openLoad));
  return (
    <div>
      <PageHeader title="Engineers" description="Workload and accounts. Engineers only ever see orders assigned to them." actions={<UserDialog action={saveUserAction.bind(null, null)} trigger="Add engineer" isNew />} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No engineers yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Engineer</Th>
                <Th className="text-right">Assigned</Th>
                <Th className="text-right">In progress</Th>
                <Th className="text-right">Completed</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="min-w-40">Open load</Th>
                <Th>Last login</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={e.active ? "" : "opacity-60"}>
                  <Td>
                    <Link href={`/engineers/${e.id}`} className="font-medium text-accent hover:underline">
                      {e.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {e.email}
                      {e.phone ? ` · ${e.phone}` : ""}
                    </div>
                    {!e.active && <Badge tone="muted">Inactive</Badge>}
                  </Td>
                  <Td className="tabular text-right">{e.assigned}</Td>
                  <Td className="tabular text-right">{e.inProgress}</Td>
                  <Td className="tabular text-right">{e.completed}</Td>
                  <Td className={`tabular text-right ${e.overdue ? "font-semibold text-[var(--tone-danger-fg)]" : ""}`}>{e.overdue}</Td>
                  <Td>
                    <div className="flex items-center gap-2" title={`${e.openLoad} open orders`}>
                      <div className="h-2 flex-1 rounded-sm bg-bar-track">
                        <div className="h-full rounded-sm bg-bar" style={{ width: `${(e.openLoad / max) * 100}%` }} />
                      </div>
                      <span className="tabular w-6 text-right text-xs">{e.openLoad}</span>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatRelative(e.lastLoginAt)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-1">
                      <UserDialog action={saveUserAction.bind(null, e.id)} trigger="Edit" values={{ name: e.name, email: e.email, phone: e.phone, role: "ENGINEER" }} />
                      <ToggleActive run={setUserActiveAction.bind(null, e.id, !e.active)} active={e.active} />
                    </div>
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
