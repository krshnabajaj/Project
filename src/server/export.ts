import ExcelJS from "exceljs";

export type Cell = string | number | null | undefined | Date;

/** Neutralise spreadsheet formula injection (=, +, -, @ at the start of a text cell). */
function safeText(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? String(v) : safeText(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

export async function toXlsx(sheets: { name: string; headers: string[]; rows: Cell[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Machine Order Tracker";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.headers).font = { bold: true };
    for (const r of s.rows) ws.addRow(r.map((v) => (typeof v === "string" ? safeText(v) : v ?? null)));
    ws.columns.forEach((c, i) => {
      const max = Math.max(s.headers[i]?.length ?? 10, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
      c.width = Math.min(50, Math.max(10, max + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
