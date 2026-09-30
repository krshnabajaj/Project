/**
 * Convert PO attachments into plain text that preserves line structure.
 * Columns are separated by a TAB so label/value and table parsing work the same
 * for PDF, Excel, Word, CSV and email bodies.
 */
export type SourceKind = "pdf" | "excel" | "word" | "image" | "text" | "unsupported";

export interface TextExtraction {
  kind: SourceKind;
  text: string;
  warning?: string;
}

const EXT_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  xlsx: "excel",
  xlsm: "excel",
  xls: "excel",
  csv: "text",
  txt: "text",
  docx: "word",
  doc: "word",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
};

export function classifyAttachment(filename: string, mimeType: string): SourceKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_KIND[ext]) return EXT_KIND[ext]!;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "excel";
  if (mimeType.includes("wordprocessing") || mimeType === "application/msword") return "word";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/")) return "text";
  return "unsupported";
}

export async function extractTextFromFile(buf: Buffer, filename: string, mimeType: string): Promise<TextExtraction> {
  const kind = classifyAttachment(filename, mimeType);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  try {
    switch (kind) {
      case "pdf": {
        const text = await pdfToText(buf);
        if (text.replace(/\s/g, "").length < 20) {
          return { kind, text, warning: `"${filename}" appears to be a scanned PDF with no text layer — details must be entered manually.` };
        }
        return { kind, text };
      }
      case "excel": {
        if (ext === "xls") {
          return { kind, text: "", warning: `"${filename}" is a legacy .xls file — automatic extraction supports .xlsx only. Please review manually.` };
        }
        return { kind, text: await xlsxToText(buf) };
      }
      case "word": {
        if (ext === "doc") {
          return { kind, text: "", warning: `"${filename}" is a legacy .doc file — automatic extraction supports .docx only. Please review manually.` };
        }
        const mammoth = await import("mammoth");
        const res = await mammoth.extractRawText({ buffer: buf });
        return { kind, text: res.value };
      }
      case "text":
        return { kind, text: buf.toString("utf8").replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "\t") };
      case "image":
        return { kind, text: "", warning: `"${filename}" is an image — text is not extracted automatically. Please review the attachment and enter PO details.` };
      default:
        return { kind, text: "", warning: `"${filename}" has an unsupported format for automatic extraction.` };
    }
  } catch (err) {
    return { kind, text: "", warning: `Could not read "${filename}": ${(err as Error).message}` };
  }
}

async function pdfToText(buf: Buffer): Promise<string> {
  const { extractTextItems } = await import("unpdf");
  const { items } = await extractTextItems(new Uint8Array(buf));
  const pages: string[] = [];
  for (const pageItems of items) {
    const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of pageItems) {
      if (!it.str.trim()) continue;
      const tol = Math.max(2, it.fontSize * 0.4);
      let row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
      if (!row) {
        row = { y: it.y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x: it.x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // PDF origin is bottom-left
    const lines = rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd: number | null = null;
      for (const p of r.parts) {
        if (prevEnd !== null) {
          const gap = p.x - prevEnd;
          line += gap > 12 ? "\t" : gap > 1 ? " " : "";
        }
        line += p.s;
        prevEnd = p.x + p.w;
      }
      return line.replace(/ {2,}/g, " ").trim();
    });
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}

async function xlsxToText(buf: Buffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        let s = "";
        if (v === null || v === undefined) s = "";
        else if (v instanceof Date) s = v.toISOString().slice(0, 10);
        else if (typeof v === "object" && "result" in v) s = String((v as { result: unknown }).result ?? "");
        else if (typeof v === "object" && "richText" in v) s = (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
        else if (typeof v === "object" && "text" in v) s = String((v as { text: unknown }).text);
        else s = String(v);
        cells.push(s.trim());
      });
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) out.push(cells.join("\t"));
    });
    out.push("");
  });
  return out.join("\n");
}
