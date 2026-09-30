import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/server/auth/session";
import { listOrders, reportData } from "@/server/services/queries";
import { toCsv, toXlsx, type Cell } from "@/server/export";
import { contentDisposition, jsonError } from "@/server/http";
import { statusLabel, isOverdue } from "@/lib/status";
import { todayIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ORDER_HEADERS = ["Order", "PO Number", "PO Date", "Customer", "Machine", "Model", "Qty", "Engineer", "Status", "Stage", "Progress %", "Expected Completion", "Overdue", "Delivery Date", "Total Value", "Currency", "Last Update", "Created"];

/** Admin export: ?report=orders|summary&format=csv|xlsx plus the order-list filters. */
export async function GET(req: NextRequest) {
  try {
    const user = await authorize("ADMIN");
    const p = req.nextUrl.searchParams;
    const format = p.get("format") === "xlsx" ? "xlsx" : "csv";
    const report = p.get("report") ?? "orders";
    const today = todayIso();
    const stamp = today;

    if (report === "summary") {
      const data = await reportData(p.get("from") ?? undefined, p.get("to") ?? undefined);
      const sheets = [
        { name: "By status", headers: ["Status", "Orders"], rows: data.byStatus.map((r) => [statusLabel(r.status), r.count] as Cell[]) },
        { name: "By customer", headers: ["Customer", "Orders"], rows: data.byCustomer.map((r) => [r.name, r.count] as Cell[]) },
        { name: "By month", headers: ["Month", "Orders"], rows: data.byMonth.map((r) => [r.month, r.count] as Cell[]) },
        { name: "Engineer performance", headers: ["Engineer", "Assigned", "Completed", "Avg completion (days)", "Overdue"], rows: data.engineers.map((e) => [e.name, e.assigned, e.completed, e.avgDays, e.overdue] as Cell[]) },
        { name: "Production", headers: ["Metric", "Machines"], rows: Object.entries(data.production).map(([k, v]) => [k, v] as Cell[]) },
      ];
      if (format === "xlsx") {
        return new NextResponse(new Uint8Array(await toXlsx(sheets)), {
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition("attachment", `report-summary-${stamp}.xlsx`) },
        });
      }
      const rows = sheets.flatMap((s) => [[`# ${s.name}`] as Cell[], s.headers as Cell[], ...s.rows, [] as Cell[]]);
      return new NextResponse(toCsv([], rows).replace(/^﻿\r\n/, "﻿"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition("attachment", `report-summary-${stamp}.csv`) },
      });
    }

    const { rows } = await listOrders(
      {
        q: p.get("q") ?? undefined,
        status: p.get("status") ?? "all",
        engineerId: p.get("engineer") ?? undefined,
        customerId: p.get("customer") ?? undefined,
        from: p.get("from") ?? undefined,
        to: p.get("to") ?? undefined,
        delayed: p.get("delayed") === "1",
        sort: p.get("sort") ?? "created",
        dir: p.get("dir") === "asc" ? "asc" : "desc",
        pageSize: 5000,
      },
      user,
    );
    const data: Cell[][] = rows.map((o) => [
      o.orderNumber ?? "(draft)",
      o.poNumber,
      o.poDate,
      o.customer?.name,
      o.machineName,
      o.machineModel,
      o.quantity,
      o.engineer?.name,
      statusLabel(o.status),
      o.currentStage?.name,
      o.progressPercentage,
      o.expectedCompletionDate,
      isOverdue(o.expectedCompletionDate, o.status, today) ? "YES" : "",
      o.deliveryDate,
      o.totalValue ? Number(o.totalValue) : null,
      o.currency,
      o.lastUpdateAt ? o.lastUpdateAt.toISOString().replace("T", " ").slice(0, 16) : null,
      o.createdAt.toISOString().slice(0, 10),
    ]);
    if (format === "xlsx") {
      return new NextResponse(new Uint8Array(await toXlsx([{ name: "Orders", headers: ORDER_HEADERS, rows: data }])), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition("attachment", `orders-${stamp}.xlsx`) },
      });
    }
    return new NextResponse(toCsv(ORDER_HEADERS, data), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition("attachment", `orders-${stamp}.csv`) },
    });
  } catch (err) {
    return jsonError(err, "export");
  }
}
