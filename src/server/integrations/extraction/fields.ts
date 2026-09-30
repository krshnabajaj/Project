/**
 * Purchase-order field extraction.
 *
 * Principles:
 *  - Never invent data. A field is only set when a value is explicitly present.
 *  - Every field carries a confidence and the text it came from.
 *  - Missing or uncertain key fields produce review warnings for the admin.
 */
export type Confidence = "high" | "medium" | "low";

export interface ExtractedField<T = string> {
  value: T;
  confidence: Confidence;
  source: string;
}

export interface PoFields {
  customerName: ExtractedField;
  billingAddress: ExtractedField;
  shippingAddress: ExtractedField;
  contactPerson: ExtractedField;
  email: ExtractedField;
  phone: ExtractedField;
  poNumber: ExtractedField;
  poDate: ExtractedField; // YYYY-MM-DD
  deliveryDate: ExtractedField; // YYYY-MM-DD
  paymentTerms: ExtractedField;
  referenceNumber: ExtractedField;
  machineName: ExtractedField;
  machineModel: ExtractedField;
  quantity: ExtractedField<number>;
  specifications: ExtractedField;
  specialInstructions: ExtractedField;
  unitPrice: ExtractedField<number>;
  totalValue: ExtractedField<number>;
  tax: ExtractedField<number>;
  currency: ExtractedField;
}

export type FieldKey = keyof PoFields;

export interface PoExtraction {
  fields: Partial<PoFields>;
  warnings: string[];
  status: "SUCCESS" | "PARTIAL" | "FAILED";
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  customerName: "customer",
  billingAddress: "billing address",
  shippingAddress: "shipping address",
  contactPerson: "contact person",
  email: "customer email",
  phone: "customer phone",
  poNumber: "PO number",
  poDate: "PO date",
  deliveryDate: "delivery date",
  paymentTerms: "payment terms",
  referenceNumber: "reference number",
  machineName: "machine / product",
  machineModel: "model number",
  quantity: "quantity",
  specifications: "specifications",
  specialInstructions: "special instructions",
  unitPrice: "unit price",
  totalValue: "total value",
  tax: "tax",
  currency: "currency",
};

/** Fields that must be confirmed before an order can be approved. */
export const KEY_FIELDS: FieldKey[] = ["customerName", "poNumber", "poDate", "machineName", "quantity", "deliveryDate"];

// ---------------------------------------------------------------- helpers

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthOf(name: string): number | undefined {
  const n = name.toLowerCase();
  return MONTHS[n.slice(0, 4)] ?? MONTHS[n.slice(0, 3)];
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse a date written in a PO. Numeric dates are read day-first (dd/mm/yyyy) as
 * is standard on Indian/European POs; if both parts could be a month, the
 * result is flagged ambiguous so the admin verifies it.
 */
export function parseDate(raw: string): { iso: string; ambiguous: boolean } | null {
  const s = raw.trim();
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const v = iso(+m[1]!, +m[2]!, +m[3]!);
    return v ? { iso: v, ambiguous: false } : null;
  }
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    const v = iso(y, b, a);
    if (v) return { iso: v, ambiguous: a <= 12 && b <= 12 && a !== b };
    const alt = iso(y, a, b); // clearly month-first (e.g. 09/30/2026)
    return alt ? { iso: alt, ambiguous: false } : null;
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})\b/);
  if (m) {
    const mon = monthOf(m[2]!);
    const v = mon ? iso(+m[3]!, mon, +m[1]!) : null;
    if (v) return { iso: v, ambiguous: false };
  }
  m = s.match(/\b([A-Za-z]{3,9})[\s.]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mon = monthOf(m[1]!);
    const v = mon ? iso(+m[3]!, mon, +m[2]!) : null;
    if (v) return { iso: v, ambiguous: false };
  }
  return null;
}

export function parseAmount(raw: string): number | null {
  const m = raw.replace(/(?<=\d),(?=\d)/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function clean(v: string): string {
  return v.replace(/\s+/g, " ").replace(/^[\s:–\-#.]+/, "").replace(/[\s,;]+$/, "").trim();
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Line = { raw: string; cells: string[] };

function toLines(text: string): Line[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((raw) => ({ raw: raw.trim(), cells: raw.split(/\t| {3,}/).map((c) => c.trim()).filter(Boolean) }));
}

interface LabelHit {
  value: string;
  lineIndex: number;
  label: string;
  inline: boolean;
}

/**
 * Find "Label: value" where the label starts a cell. Falls back to the next cell
 * on the same line, then the next non-empty line (label above value).
 */
function findLabel(lines: Line[], labels: string[], opts: { allowNextLine?: boolean } = {}): LabelHit | null {
  const alternation = labels.map((l) => escape(l).replace(/\\ /g, "\\s*").replace(/\\\./g, "\\.?")).join("|");
  const re = new RegExp(`^(?:${alternation})(?![a-z])\\s*(?:no\\.?|number|#)?\\s*[:\\-–#.]*\\s*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i]!.cells;
    for (let c = 0; c < cells.length; c++) {
      const m = cells[c]!.match(re);
      if (!m) continue;
      const label = cells[c]!.slice(0, cells[c]!.length - m[1]!.length).replace(/[\s:\-–#.]+$/, "").trim();
      const rest = clean(m[1] ?? "");
      if (rest) return { value: rest, lineIndex: i, label, inline: true };
      if (cells[c + 1]) return { value: clean(cells[c + 1]!), lineIndex: i, label, inline: true };
      if (opts.allowNextLine !== false) {
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          if (lines[j]!.cells.length) return { value: clean(lines[j]!.cells[0]!), lineIndex: j, label, inline: false };
        }
      }
    }
  }
  return null;
}

const ANY_LABEL = /^(po|p\.o|purchase|order|date|delivery|ship|bill|invoice|payment|terms|gst|tax|total|qty|quantity|model|contact|attn|kind attn|phone|tel|mobile|email|e-mail|ref|reference|description|item|product|machine|rate|unit|amount|remarks|notes|special|specification|buyer|customer|vendor|supplier|consignee)\b/i;

/** Multi-line block after a label (addresses): stops at a blank line or another label. */
function findBlock(lines: Line[], labels: string[], maxLines = 5): { name: string; block: string; label: string } | null {
  const hit = findLabel(lines, labels);
  if (!hit) return null;
  const parts = [hit.value];
  for (let j = hit.lineIndex + 1; j < Math.min(lines.length, hit.lineIndex + maxLines); j++) {
    const line = lines[j]!;
    if (!line.raw || ANY_LABEL.test(line.cells[0] ?? "")) break;
    // In two-column layouts only take the cell under the label.
    parts.push(line.cells[0]!);
  }
  const filtered = parts.filter(Boolean).filter((p, i) => i > 0 || !ANY_LABEL.test(p));
  if (!filtered.length) return null;
  return { name: filtered[0]!, block: filtered.join(", "), label: hit.label };
}

// ------------------------------------------------------------------ main

export interface ExtractionContext {
  subject?: string;
  senderName?: string | null;
  senderEmail?: string | null;
}

export function extractPoFields(text: string, ctx: ExtractionContext = {}): PoExtraction {
  const fields: Partial<PoFields> = {};
  const warnings: string[] = [];
  const lines = toLines(text);
  const hasText = text.replace(/\s/g, "").length > 0;

  const set = <K extends FieldKey>(key: K, value: PoFields[K]["value"] | null | undefined, confidence: Confidence, source: string) => {
    if (value === null || value === undefined || value === "" || fields[key]) return;
    (fields as Record<string, ExtractedField<unknown>>)[key] = { value, confidence, source: source.slice(0, 200) };
  };

  // ---- PO number
  const poHit = findLabel(lines, [
    "Purchase Order No", "Purchase Order Number", "Purchase Order #", "P.O. No", "P.O. Number", "PO No", "PO Number", "PO #", "PO Ref", "Order No", "Order Number",
  ]);
  const poToken = (v: string) => v.match(/^[A-Z0-9][A-Z0-9\-\/_.]{0,40}/i)?.[0]?.replace(/[.\-/]+$/, "");
  if (poHit) {
    const tok = poToken(poHit.value);
    if (tok && /\d/.test(tok)) set("poNumber", tok, /order no|order number/i.test(poHit.label) ? "medium" : "high", `${poHit.label}: ${poHit.value}`);
  }
  if (!fields.poNumber) {
    const m = text.match(/\b(?:P\.?\s?O\.?|Purchase\s+Order)\s*(?:No\.?|Number|#)?\s*[:\-#]?\s*((?:PO[-/])?[A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)/i);
    if (m) set("poNumber", m[1]!.replace(/[.\-/]+$/, ""), "medium", m[0]);
  }
  if (!fields.poNumber && ctx.subject) {
    const m = ctx.subject.match(/\b(?:P\.?O\.?|Purchase\s+Order)\s*(?:No\.?|Number|#)?\s*[:\-#]?\s*((?:PO[-/])?[A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)/i) ?? ctx.subject.match(/\b(PO[-/]?\d{2,}[A-Z0-9\-/]*)\b/i);
    if (m) set("poNumber", m[1]!, "medium", `Email subject: ${ctx.subject}`);
  }

  // ---- Dates
  const dateField = (key: "poDate" | "deliveryDate", labels: string[], baseConfidence: Confidence) => {
    const hit = findLabel(lines, labels);
    if (!hit) return;
    const d = parseDate(hit.value);
    if (!d) return;
    set(key, d.iso, d.ambiguous ? "low" : baseConfidence, `${hit.label}: ${hit.value}`);
    if (d.ambiguous) warnings.push(`${FIELD_LABELS[key]} "${hit.value}" is ambiguous (read as day/month/year = ${d.iso}). Please verify.`);
  };
  dateField("poDate", ["PO Date", "P.O. Date", "Purchase Order Date", "Order Date", "Date of PO", "PO Dt", "Dated"], "high");
  if (!fields.poDate) {
    const inline = text.match(/\b(?:P\.?O\.?|Purchase\s+Order)[^\n]{0,60}?\b(?:dated|date[d]?\s*[:\-]?)\s*([0-9A-Za-z ,./\-]{6,20})/i);
    const d = inline ? parseDate(inline[1]!) : null;
    if (d) set("poDate", d.iso, d.ambiguous ? "low" : "medium", inline![0]);
  }
  if (!fields.poDate) {
    const hit = findLabel(lines, ["Date"], { allowNextLine: false });
    const d = hit ? parseDate(hit.value) : null;
    if (d) {
      set("poDate", d.iso, "low", `${hit!.label}: ${hit!.value}`);
      warnings.push(`PO date taken from a generic "Date" label (${d.iso}). Please verify.`);
    }
  }
  dateField(
    "deliveryDate",
    ["Delivery Date", "Date of Delivery", "Delivery By", "Deliver By", "Required By", "Required Date", "Expected Delivery", "Delivery Schedule", "Delivery", "Due Date", "Dispatch Date", "Need By"],
    "high",
  );

  // ---- Terms & references
  const payHit = findLabel(lines, ["Payment Terms", "Terms of Payment", "Payment Term", "Payment"]);
  if (payHit) set("paymentTerms", payHit.value.slice(0, 200), "high", `${payHit.label}: ${payHit.value}`);
  const refHit = findLabel(lines, ["Reference No", "Reference Number", "Ref No", "Ref. No", "Your Ref", "Our Ref", "Quotation No", "Quotation Ref", "Quote No", "Quote Ref", "Reference", "Ref"]);
  if (refHit) {
    const tok = refHit.value.match(/^[A-Z0-9][A-Z0-9\-\/_. ]{0,40}/i)?.[0]?.trim();
    if (tok && /\d/.test(tok)) set("referenceNumber", tok, "high", `${refHit.label}: ${refHit.value}`);
  }

  // ---- Customer
  const billBlock = findBlock(lines, ["Bill To", "Billed To", "Billing Address", "Invoice To", "Buyer", "Purchaser"]);
  const nameHit = findLabel(lines, ["Customer Name", "Company Name", "Buyer Name", "Customer", "Client", "Hospital Name", "Organisation", "Organization"]);
  if (nameHit && !ANY_LABEL.test(nameHit.value)) set("customerName", nameHit.value.slice(0, 150), "high", `${nameHit.label}: ${nameHit.value}`);
  if (billBlock) {
    set("customerName", billBlock.name.slice(0, 150), "medium", `${billBlock.label}: ${billBlock.name}`);
    const addr = billBlock.block.startsWith(billBlock.name) ? billBlock.block.slice(billBlock.name.length).replace(/^,\s*/, "") : billBlock.block;
    if (addr) set("billingAddress", addr.slice(0, 500), "medium", `${billBlock.label} block`);
  }
  const addrHit = findBlock(lines, ["Billing Address", "Address"]);
  if (addrHit) set("billingAddress", addrHit.block.slice(0, 500), "medium", `${addrHit.label} block`);
  const shipBlock = findBlock(lines, ["Ship To", "Shipping Address", "Delivery Address", "Deliver To", "Consignee", "Delivery Location", "Site Address"]);
  if (shipBlock) set("shippingAddress", shipBlock.block.slice(0, 500), "medium", `${shipBlock.label} block`);
  const contactHit = findLabel(lines, ["Contact Person", "Kind Attn", "Kind Attention", "Attn", "Attention", "Contact Name", "Contact"]);
  if (contactHit) {
    const v = contactHit.value.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/, "").replace(/\+?\d[\d\s-]{7,}/, "").replace(/[,;|]+\s*$/, "").trim();
    if (v && /[a-z]/i.test(v) && !ANY_LABEL.test(v)) set("contactPerson", v.slice(0, 100), "high", `${contactHit.label}: ${contactHit.value}`);
  }
  const emailHit = findLabel(lines, ["Email", "E-mail", "Email ID", "Mail"]);
  const emailVal = emailHit?.value.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0];
  if (emailVal) set("email", emailVal.toLowerCase(), "high", `${emailHit!.label}: ${emailHit!.value}`);
  else if (ctx.senderEmail) set("email", ctx.senderEmail, "medium", "Email sender");
  const phoneHit = findLabel(lines, ["Phone", "Tel", "Telephone", "Mobile", "Mob", "Contact No", "Ph"]);
  const phoneVal = phoneHit?.value.match(/\+?\d[\d\s\-()]{7,18}\d/)?.[0];
  if (phoneVal) set("phone", phoneVal.replace(/\s+/g, " ").trim(), "high", `${phoneHit!.label}: ${phoneHit!.value}`);

  // ---- Line-item table (Description | Model | Qty | Rate | Amount)
  const table = parseItemTable(lines);
  if (table) {
    if (table.description) set("machineName", table.description.slice(0, 200), "medium", `Item table: ${table.row}`);
    if (table.model) set("machineModel", table.model.slice(0, 100), "medium", `Item table: ${table.row}`);
    if (table.qty !== null) set("quantity", table.qty, "medium", `Item table: ${table.row}`);
    if (table.rate !== null) set("unitPrice", table.rate, "medium", `Item table: ${table.row}`);
  }

  // ---- Machine
  const machineHit = findLabel(lines, ["Machine Name", "Machine", "Equipment", "Product Name", "Product", "Item Description", "Item Name", "Item", "Description of Goods", "Description"]);
  if (machineHit && !ANY_LABEL.test(machineHit.value) && machineHit.value.length > 2) {
    set("machineName", machineHit.value.slice(0, 200), "high", `${machineHit.label}: ${machineHit.value}`);
  }
  const modelHit = findLabel(lines, ["Model No", "Model Number", "Model", "Part No", "Part Number", "Catalogue No", "Cat No"]);
  if (modelHit) {
    const tok = modelHit.value.match(/^[A-Z0-9][A-Z0-9\-\/_. ]{0,40}/i)?.[0]?.trim();
    if (tok) set("machineModel", tok, "high", `${modelHit.label}: ${modelHit.value}`);
  }
  const qtyHit = findLabel(lines, ["Quantity", "Qty", "No. of Units", "Number of Units", "No of Machines", "Units"]);
  if (qtyHit) {
    const m = qtyHit.value.match(/^(\d{1,5})(?:\.0+)?\b/);
    if (m) set("quantity", Number(m[1]), "high", `${qtyHit.label}: ${qtyHit.value}`);
  }
  const specHit = findBlock(lines, ["Technical Specifications", "Specifications", "Specification", "Specs", "Technical Details"], 6);
  if (specHit) set("specifications", specHit.block.slice(0, 2000), "medium", `${specHit.label} block`);
  const instrHit = findBlock(lines, ["Special Instructions", "Special Instruction", "Instructions", "Remarks", "Notes", "Note"], 4);
  if (instrHit) set("specialInstructions", instrHit.block.slice(0, 2000), "medium", `${instrHit.label} block`);

  // ---- Commercials
  const unitHit = findLabel(lines, ["Unit Price", "Unit Rate", "Price per Unit", "Rate per Unit", "Rate", "Price"]);
  const unitVal = unitHit ? parseAmount(unitHit.value) : null;
  if (unitVal !== null) set("unitPrice", unitVal, "high", `${unitHit!.label}: ${unitHit!.value}`);
  const totalHit = findLabel(lines, ["Grand Total", "Total Amount", "Total Order Value", "Total PO Value", "Total Value", "Net Amount", "Net Total", "PO Value", "Order Value", "Total"]);
  const totalVal = totalHit ? parseAmount(totalHit.value) : null;
  if (totalVal !== null) set("totalValue", totalVal, /^total$/i.test(totalHit!.label) ? "medium" : "high", `${totalHit!.label}: ${totalHit!.value}`);
  const taxHit = findLabel(lines, ["Total Tax", "Tax Amount", "GST Amount", "IGST", "GST", "VAT", "Tax"]);
  const taxVal = taxHit ? parseAmount(taxHit.value.replace(/^\s*@?\s*\d+(\.\d+)?\s*%\s*/, "")) : null;
  if (taxVal !== null) set("tax", taxVal, "medium", `${taxHit!.label}: ${taxHit!.value}`);

  const currency = detectCurrency(text);
  if (currency) set("currency", currency.code, currency.confidence, currency.source);

  // ---- Customer fallback from the email sender (low confidence, must be confirmed)
  if (!fields.customerName && ctx.senderName) {
    set("customerName", ctx.senderName, "low", "Email sender name");
    warnings.push(`Customer name was taken from the email sender ("${ctx.senderName}"). Please confirm.`);
  }

  // ---- Review warnings
  if (!hasText) {
    warnings.unshift("We could not automatically extract all PO details. Please review the order manually.");
  }
  for (const key of KEY_FIELDS) {
    if (!fields[key]) warnings.push(`PO imported successfully but ${FIELD_LABELS[key]} could not be identified.`);
    else if (fields[key]!.confidence === "low" && !warnings.some((w) => w.toLowerCase().includes(FIELD_LABELS[key].toLowerCase()))) {
      warnings.push(`${capitalize(FIELD_LABELS[key])} was extracted with low confidence. Please verify.`);
    }
  }
  if (fields.quantity && fields.unitPrice && fields.totalValue) {
    const expected = fields.quantity.value * fields.unitPrice.value;
    if (fields.totalValue.value + 0.01 < expected) {
      warnings.push(`Total value (${fields.totalValue.value}) is less than quantity × unit price (${expected}). Please verify commercials.`);
    }
  }

  const foundKeys = KEY_FIELDS.filter((k) => fields[k]);
  const status: PoExtraction["status"] =
    foundKeys.length === 0 ? "FAILED" : foundKeys.length === KEY_FIELDS.length && KEY_FIELDS.every((k) => fields[k]!.confidence !== "low") ? "SUCCESS" : "PARTIAL";
  if (status === "FAILED" && hasText) {
    warnings.unshift("We could not automatically extract all PO details. Please review the order manually.");
  }
  return { fields, warnings: [...new Set(warnings)], status };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detectCurrency(text: string): { code: string; confidence: Confidence; source: string } | null {
  const checks: [RegExp, string][] = [
    [/₹|\bINR\b|\bRs\.?\s?\d/i, "INR"],
    [/\bUSD\b|US\$/, "USD"],
    [/€|\bEUR\b/, "EUR"],
    [/£|\bGBP\b/, "GBP"],
    [/\bAED\b/, "AED"],
    [/\$\s?\d/, "USD"],
  ];
  const found: { code: string; source: string }[] = [];
  for (const [re, code] of checks) {
    const m = text.match(re);
    if (m && !found.some((f) => f.code === code)) found.push({ code, source: m[0] });
  }
  if (!found.length) return null;
  return { code: found[0]!.code, confidence: found.length === 1 ? "high" : "low", source: `Currency marker "${found[0]!.source}"` };
}

interface TableRow {
  description: string | null;
  model: string | null;
  qty: number | null;
  rate: number | null;
  row: string;
}

function parseItemTable(lines: Line[]): TableRow | null {
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]!.cells.map((c) => c.toLowerCase());
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const descIdx = col(/^(description|item description|product|particulars|item|machine|equipment|description of goods)/);
    const qtyIdx = col(/^(qty|quantity|nos|units)\b/);
    if (descIdx < 0 || qtyIdx < 0 || header.length < 2) continue;
    const modelIdx = col(/^(model|model no|part no|cat)/);
    const rateIdx = col(/^(rate|unit price|unit rate|price)/);
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const cells = lines[j]!.cells;
      if (cells.length < 2) continue;
      // Leading serial-number column present in data but unlabeled in header.
      const offset = cells.length === header.length + 1 && /^\d{1,3}\.?$/.test(cells[0]!) ? 1 : 0;
      const at = (k: number) => (k >= 0 ? cells[k + offset] ?? null : null);
      const qtyRaw = at(qtyIdx);
      const qty = qtyRaw?.match(/^(\d{1,5})(?:\.0+)?\b/)?.[1];
      const desc = at(descIdx);
      if (!desc || !qty) continue;
      const rateRaw = at(rateIdx);
      return {
        description: desc,
        model: at(modelIdx),
        qty: Number(qty),
        rate: rateRaw ? parseAmount(rateRaw) : null,
        row: lines[j]!.raw,
      };
    }
  }
  return null;
}
