import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { canPerform, availableActions } from "@/lib/workflow";
import { isOverdue } from "@/lib/status";
import { extractPoFields, parseDate } from "@/server/integrations/extraction/fields";
import { extractTextFromFile } from "@/server/integrations/extraction/text";
import { normalizePoNumber } from "@/server/services/duplicates";
import { formatOrderNumber } from "@/server/services/order-number";
import { MetaWhatsAppProvider } from "@/server/integrations/whatsapp/meta";
import { TwilioWhatsAppProvider } from "@/server/integrations/whatsapp/twilio";
import { normalizePhone } from "@/server/integrations/whatsapp";
import { buildSearchQuery } from "@/server/integrations/gmail/sync";
import { settingSchemas } from "@/server/settings";
import { toCsv } from "@/server/export";
import { encrypt, decrypt } from "@/lib/crypto";
import { poPdf, SAMPLE_PO_LINES } from "./helpers";

describe("workflow state machine", () => {
  it("only lets admins assign, pack, mark ready and dispatch", () => {
    expect(canPerform("ASSIGN", "ADMIN", "ORDER_CREATED")).toBe(true);
    expect(canPerform("ASSIGN", "ENGINEER", "ORDER_CREATED")).toBe(false);
    expect(canPerform("REASSIGN", "ENGINEER", "ASSEMBLY_IN_PROGRESS")).toBe(false);
    expect(canPerform("MARK_READY", "ENGINEER", "PACKED")).toBe(false);
    expect(canPerform("MARK_DISPATCHED", "ENGINEER", "READY_FOR_DISPATCH")).toBe(false);
    expect(canPerform("MARK_READY", "ADMIN", "PACKED")).toBe(true);
  });

  it("forbids jumping over states", () => {
    expect(canPerform("MARK_READY", "ADMIN", "ASSEMBLY_IN_PROGRESS")).toBe(false);
    expect(canPerform("MARK_PACKED", "ADMIN", "COMPLETED")).toBe(false); // photos first
    expect(canPerform("MARK_COMPLETED", "ENGINEER", "ASSIGNED")).toBe(false); // must accept + work
    expect(canPerform("ACCEPT", "ENGINEER", "ORDER_CREATED")).toBe(false);
    expect(canPerform("MARK_DISPATCHED", "ADMIN", "PACKED")).toBe(false);
    expect(canPerform("APPROVE", "ADMIN", "ASSIGNED")).toBe(false);
  });

  it("engineers get only their production actions", () => {
    expect(availableActions("ENGINEER", "ASSIGNED")).toEqual(["ACCEPT"]);
    expect(availableActions("ENGINEER", "READY_FOR_DISPATCH")).toEqual([]);
  });

  it("identifies overdue orders (expected < today, not completed)", () => {
    expect(isOverdue(new Date("2026-09-29T00:00:00Z"), "ASSEMBLY_IN_PROGRESS", "2026-09-30")).toBe(true);
    expect(isOverdue(new Date("2026-09-30T00:00:00Z"), "ASSEMBLY_IN_PROGRESS", "2026-09-30")).toBe(false);
    expect(isOverdue(new Date("2026-09-01T00:00:00Z"), "COMPLETED", "2026-09-30")).toBe(false);
    expect(isOverdue(null, "TESTING", "2026-09-30")).toBe(false);
  });
});

describe("PO extraction", () => {
  it("extracts all key fields from a text PDF PO", async () => {
    const pdf = await poPdf(SAMPLE_PO_LINES);
    const t = await extractTextFromFile(pdf, "PO-4587.pdf", "application/pdf");
    expect(t.kind).toBe("pdf");
    const r = extractPoFields(t.text, { senderEmail: "purchase@abchospital.com" });
    expect(r.fields.poNumber?.value).toBe("PO-4587");
    expect(r.fields.poDate?.value).toBe("2026-09-25");
    expect(r.fields.deliveryDate?.value).toBe("2026-10-30");
    expect(r.fields.machineName?.value).toBe("Automatic Washer Disinfector");
    expect(r.fields.machineModel?.value).toBe("AWD-500");
    expect(r.fields.quantity?.value).toBe(2);
    expect(r.fields.customerName?.value).toBe("ABC Hospital Pvt Ltd");
    expect(r.fields.totalValue?.value).toBe(1062000);
    expect(r.fields.currency?.value).toBe("INR");
    expect(r.status).toBe("SUCCESS");
  });

  it("does not invent missing information and flags it for review", () => {
    const r = extractPoFields("Purchase Order No: 7781\nItem: Instrument Washer\nQty: 1");
    expect(r.fields.deliveryDate).toBeUndefined();
    expect(r.fields.customerName).toBeUndefined();
    expect(r.fields.unitPrice).toBeUndefined();
    expect(r.warnings).toContain("PO imported successfully but delivery date could not be identified.");
    expect(r.status).toBe("PARTIAL");
  });

  it("flags ambiguous numeric dates instead of assuming", () => {
    expect(parseDate("04/09/2026")).toEqual({ iso: "2026-09-04", ambiguous: true });
    expect(parseDate("30/09/2026")).toEqual({ iso: "2026-09-30", ambiguous: false });
    const r = extractPoFields("PO No: X-12\nPO Date: 04/09/2026");
    expect(r.fields.poDate?.confidence).toBe("low");
    expect(r.warnings.some((w) => w.includes("ambiguous"))).toBe(true);
  });

  it("reports a clear failure when nothing can be read", () => {
    const r = extractPoFields("");
    expect(r.status).toBe("FAILED");
    expect(r.warnings[0]).toBe("We could not automatically extract all PO details. Please review the order manually.");
  });

  it("reads Excel POs", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PO");
    ws.addRow(["PO Number", "LP/88/2026"]);
    ws.addRow(["PO Date", "2026-09-20"]);
    ws.addRow(["Customer Name", "Lotus Pharma"]);
    ws.addRow(["Description", "Qty", "Rate"]);
    ws.addRow(["Pharmaceutical Autoclave", 1, 2100000]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const t = await extractTextFromFile(buf, "po.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const r = extractPoFields(t.text);
    expect(r.fields.poNumber?.value).toBe("LP/88/2026");
    expect(r.fields.customerName?.value).toBe("Lotus Pharma");
    expect(r.fields.machineName?.value).toBe("Pharmaceutical Autoclave");
    expect(r.fields.quantity?.value).toBe(1);
  });

  it("flags image attachments for manual review (no OCR guessing)", async () => {
    const t = await extractTextFromFile(Buffer.from([0xff, 0xd8, 0xff]), "scan.jpg", "image/jpeg");
    expect(t.text).toBe("");
    expect(t.warning).toMatch(/image/);
  });
});

describe("helpers", () => {
  it("formats order numbers ORD-YYYY-NNNN", () => {
    expect(formatOrderNumber(2026, 45)).toBe("ORD-2026-0045");
  });
  it("normalizes PO numbers for duplicate checks", () => {
    expect(normalizePoNumber("PO-4587")).toBe("4587");
    expect(normalizePoNumber("po 4587")).toBe("4587");
    expect(normalizePoNumber("LP/88/2026")).toBe("LP882026");
  });
  it("encrypts tokens with AES-GCM (tamper-evident)", () => {
    const c = encrypt("refresh-token");
    expect(c).not.toContain("refresh-token");
    expect(decrypt(c)).toBe("refresh-token");
    const parts = c.split(".");
    parts[2] = Buffer.from("x").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("builds the Gmail search query from PO rules", () => {
    const rules = settingSchemas.gmail.parse({ senderAllowlist: ["@abc.com"], label: "Purchase Orders", requireAttachment: true });
    const q = buildSearchQuery(rules);
    expect(q).toContain('subject:("purchase order" OR PO OR "order confirmation")');
    expect(q).toContain("from:(@abc.com)");
    expect(q).toContain("label:Purchase-Orders");
    expect(q).toContain("has:attachment");
  });
  it("neutralizes CSV formula injection", () => {
    expect(toCsv(["a"], [["=HYPERLINK(1)"]])).toContain("'=HYPERLINK(1)");
  });
});

describe("WhatsApp providers", () => {
  it("Meta Cloud API: correct endpoint, auth and payload", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const p = new MetaWhatsAppProvider({ apiUrl: "https://graph.facebook.com/v21.0", accessToken: "tok", phoneNumberId: "123" }, async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    });
    const r = await p.send({ to: "+91 98000 00001", body: "Hello" });
    expect(r.providerMessageId).toBe("wamid.X");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/123/messages");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ messaging_product: "whatsapp", to: "919800000001", type: "text", text: { body: "Hello" } });
  });

  it("Meta template mode flattens newlines into a single parameter", () => {
    const p = new MetaWhatsAppProvider({ apiUrl: "x", accessToken: "t", phoneNumberId: "1", templateName: "order_update" });
    const payload = p.buildPayload({ to: "+919800000001", body: "A\nB" }) as { template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(payload.template.name).toBe("order_update");
    expect(payload.template.components[0]!.parameters[0]!.text).toBe("A | B");
  });

  it("surfaces provider errors (never silent)", async () => {
    const p = new MetaWhatsAppProvider({ apiUrl: "x", accessToken: "t", phoneNumberId: "1" }, async () => new Response(JSON.stringify({ error: { message: "Invalid token", code: 190 } }), { status: 401 }));
    await expect(p.send({ to: "+919800000001", body: "x" })).rejects.toThrow(/Invalid token/);
  });

  it("Twilio: basic auth + whatsapp: prefixed numbers", async () => {
    let body = "";
    let auth = "";
    const p = new TwilioWhatsAppProvider({ apiUrl: "https://api.twilio.com/2010-04-01", accountSid: "AC1", authToken: "secret", fromNumber: "+14155238886" }, async (_u, init) => {
      body = String(init!.body);
      auth = (init!.headers as Record<string, string>).Authorization!;
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    });
    expect((await p.send({ to: "+919800000001", body: "Hi" })).providerMessageId).toBe("SM1");
    expect(new URLSearchParams(body).get("To")).toBe("whatsapp:+919800000001");
    expect(auth).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
  });

  it("validates phone numbers", () => {
    expect(normalizePhone("0091 98000 00001")).toBe("+919800000001");
    expect(() => normalizePhone("12")).toThrow();
  });
});
