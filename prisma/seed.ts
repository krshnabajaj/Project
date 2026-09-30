/**
 * DEMO / DEVELOPMENT SEED DATA — clearly labelled (is_demo = true, @demo.local emails).
 * Do NOT run against production. For production, create the first admin with:
 *   npm run create-admin -- --email you@company.com --name "Your Name"
 *
 * Creates: 1 admin, 4 engineers, 5 customers, 14 orders across every lifecycle stage.
 */
import { PrismaClient, type OrderStatus, type StagePhase } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { storage } from "../src/server/integrations/storage";
import { DEFAULT_STAGES } from "../src/server/services/stages";

const prisma = new PrismaClient();

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "DemoAdmin2026";
const ENGINEER_PASSWORD = process.env.SEED_ENGINEER_PASSWORD ?? "DemoEngineer2026";

function tzToday(): string {
  const tz = process.env.APP_TIMEZONE || "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const TODAY = tzToday();
const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const at = (offset: number, hour = 18, minute = 0) => {
  const d = day(offset);
  d.setUTCHours(hour - 5, minute - 30); // IST → UTC
  return d;
};

async function demoPhoto(label: string, hue: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <rect width="100%" height="100%" fill="hsl(${hue},18%,32%)"/>
    <rect x="260" y="200" width="680" height="480" rx="24" fill="hsl(${hue},10%,78%)" stroke="#222" stroke-width="6"/>
    <rect x="320" y="260" width="240" height="160" rx="8" fill="#1f2937"/>
    <circle cx="780" cy="340" r="70" fill="#9ca3af" stroke="#222" stroke-width="6"/>
    <text x="600" y="780" font-family="sans-serif" font-size="46" fill="#fff" text-anchor="middle">${label}</text>
    <text x="600" y="840" font-family="sans-serif" font-size="30" fill="#ddd" text-anchor="middle">DEMO PHOTO</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production. Use npm run create-admin instead.");
  }
  if ((await prisma.user.count()) > 0) {
    console.log("Database already contains users — skipping demo seed. Run `npm run db:reset` for a fresh demo database.");
    return;
  }

  // ---------------------------------------------------------------- stages
  const stages: Awaited<ReturnType<typeof prisma.assemblyStage.create>>[] = [];
  for (const [i, s] of DEFAULT_STAGES.entries()) {
    stages.push(await prisma.assemblyStage.create({ data: { ...s, phase: s.phase as StagePhase, sequence: (i + 1) * 10 } }));
  }
  const stageByName = (n: string) => stages.find((s) => s.name === n)!;

  // ---------------------------------------------------------------- settings
  await prisma.setting.createMany({
    data: [
      { key: "company", value: { name: "Demo Medical Systems Pvt Ltd", address: "Plot 12, MIDC Bhosari, Pune 411026", phone: "+91 20 5555 0100", email: "info@demo.local", website: "", logoUrl: "" } },
      { key: "email", value: { adminEmail: process.env.ADMIN_EMAIL || "admin@demo.local", completionRecipients: [], ccRecipients: [], attachPhotos: true } },
    ],
  });

  // ---------------------------------------------------------------- users
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const engHash = await bcrypt.hash(ENGINEER_PASSWORD, 12);
  const admin = await prisma.user.create({ data: { name: "Admin User", email: "admin@demo.local", phone: "+919800000001", role: "ADMIN", passwordHash: adminHash, isDemo: true } });
  const [rahul, priya, amit, sanjay] = await Promise.all(
    [
      ["Rahul Verma", "rahul@demo.local", "+919800000011"],
      ["Priya Nair", "priya@demo.local", "+919800000012"],
      ["Amit Patel", "amit@demo.local", "+919800000013"],
      ["Sanjay Kumar", "sanjay@demo.local", "+919800000014"],
    ].map(([name, email, phone]) => prisma.user.create({ data: { name: name!, email: email!, phone, role: "ENGINEER", passwordHash: engHash, isDemo: true } })),
  );

  // ---------------------------------------------------------------- customers
  const cust = await Promise.all(
    [
      ["ABC Hospital Pvt Ltd", "12 MG Road, Pune 411001", "Dr. Meera Shah", "purchase@abchospital.example", "+91 98765 43210", "abchospital.example"],
      ["Sunrise Multispeciality Hospital", "45 Ring Road, Ahmedabad 380015", "Mr. Kiran Desai", "stores@sunrisehospital.example", "+91 98250 11223", "sunrisehospital.example"],
      ["Metro Diagnostics Ltd", "7 Park Street, Kolkata 700016", "Ms. Ananya Roy", "procurement@metrodiag.example", "+91 90070 44556", "metrodiag.example"],
      ["Lotus Pharma Industries", "Survey 88, Baddi, Himachal Pradesh 173205", "Mr. Harpreet Singh", "po@lotuspharma.example", "+91 98160 77889", "lotuspharma.example"],
      ["City Care Clinics", "3 Anna Salai, Chennai 600002", "Dr. Arjun Iyer", "admin@citycare.example", "+91 94440 99001", "citycare.example"],
    ].map(([name, address, contact, email, phone, domain]) =>
      prisma.customer.create({ data: { name: name!, billingAddress: address, shippingAddress: address, contactPerson: contact, email, phone, emailDomain: domain, isDemo: true } }),
    ),
  );

  // ---------------------------------------------------------------- orders
  let seq = 0;
  const year = Number(TODAY.slice(0, 4));
  const nextNumber = () => `ORD-${year}-${String(++seq).padStart(4, "0")}`;

  interface Update {
    dayOffset: number;
    stage: string;
    progress: number;
    work: string;
    issue?: string;
    delay?: number;
    next?: string;
    material?: string;
  }
  interface Spec {
    status: OrderStatus;
    customer: number;
    po: string;
    poDateOffset: number;
    machine: string;
    model: string;
    qty: number;
    price: number;
    engineer?: typeof rahul;
    expectedOffset?: number;
    updates?: Update[];
    photos?: number;
    photosSubmitted?: boolean;
    holdReason?: string;
    gmail?: { subject: string; warnings: string[]; extraction: "SUCCESS" | "PARTIAL" | "FAILED"; duplicateOf?: number };
  }

  const specs: Spec[] = [
    { status: "PO_RECEIVED", customer: 2, po: "MD/PO/2026/318", poDateOffset: -1, machine: "Automatic Tube Sealer", model: "ATS-200", qty: 3, price: 185000, gmail: { subject: "Purchase Order MD/PO/2026/318", warnings: ["PO imported successfully but delivery date could not be identified."], extraction: "PARTIAL" } },
    { status: "ORDER_CREATED", customer: 4, po: "CCC-PO-1102", poDateOffset: -2, machine: "Plasma Sterilizer", model: "PS-60", qty: 1, price: 1250000, expectedOffset: 25 },
    { status: "ASSIGNED", customer: 3, po: "LPI/2026/0917", poDateOffset: -4, machine: "Pharmaceutical Autoclave", model: "PA-1000L", qty: 1, price: 2100000, engineer: rahul, expectedOffset: 30 },
    { status: "ACCEPTED", customer: 1, po: "SMH-PO-7781", poDateOffset: -6, machine: "Instrument Washer", model: "IW-300", qty: 2, price: 380000, engineer: priya, expectedOffset: 21 },
    {
      status: "ASSEMBLY_IN_PROGRESS", customer: 0, po: "PO-4587", poDateOffset: -14, machine: "Automatic Washer Disinfector", model: "AWD-500", qty: 2, price: 450000, engineer: rahul, expectedOffset: 12,
      updates: [
        { dayOffset: -9, stage: "Material Issued", progress: 10, work: "All material received from stores and verified against BOM.", next: "Frame assembly" },
        { dayOffset: -2, stage: "Mechanical Assembly", progress: 30, work: "Main frame and chamber mounted. Door mechanism fitted.", next: "Pump and piping brackets" },
        { dayOffset: -1, stage: "Mechanical Assembly", progress: 35, work: "Pump brackets fitted, alignment checked.", next: "Electrical assembly" },
      ],
    },
    {
      status: "ASSEMBLY_IN_PROGRESS", customer: 2, po: "MD/PO/2026/287", poDateOffset: -30, machine: "Ultrasonic Cleaner", model: "UC-120", qty: 4, price: 95000, engineer: amit, expectedOffset: -2,
      updates: [
        { dayOffset: -20, stage: "Material Issued", progress: 10, work: "Material issued." },
        { dayOffset: -12, stage: "Mechanical Assembly", progress: 30, work: "Tanks and frames assembled for all 4 units." },
        { dayOffset: -3, stage: "Electrical Assembly", progress: 50, work: "Control panel wiring started." },
        { dayOffset: -1, stage: "Electrical Assembly", progress: 55, work: "Control panel wiring completed.", issue: "Waiting for 2 connectors from supplier.", delay: 2, material: "2 × 12-pin connectors", next: "PLC wiring" },
      ],
    },
    {
      status: "TESTING", customer: 3, po: "LPI/2026/0833", poDateOffset: -40, machine: "Water Distillation Plant", model: "WDP-500", qty: 1, price: 1650000, engineer: priya, expectedOffset: 4,
      updates: [
        { dayOffset: -30, stage: "Material Issued", progress: 10, work: "Material issued." },
        { dayOffset: -24, stage: "Mechanical Assembly", progress: 25, work: "Columns and skid assembled." },
        { dayOffset: -18, stage: "Plumbing / Piping", progress: 50, work: "SS316 piping and orbital welding completed." },
        { dayOffset: -10, stage: "Control Panel / PLC", progress: 65, work: "PLC panel installed." },
        { dayOffset: -5, stage: "Software / Programming", progress: 75, work: "PLC and HMI programming completed." },
        { dayOffset: -1, stage: "Testing", progress: 85, work: "Hydro test passed; performance run in progress.", next: "Final inspection" },
      ],
    },
    {
      status: "COMPLETED", customer: 1, po: "SMH-PO-7702", poDateOffset: -35, machine: "Bedpan Washer", model: "BW-40", qty: 1, price: 310000, engineer: sanjay, expectedOffset: 1, photos: 3,
      updates: [
        { dayOffset: -25, stage: "Mechanical Assembly", progress: 30, work: "Body assembled." },
        { dayOffset: -12, stage: "Electrical Assembly", progress: 55, work: "Wiring completed." },
        { dayOffset: -4, stage: "Final Inspection", progress: 95, work: "Final inspection completed." },
      ],
    },
    {
      status: "PHOTOS_UPLOADED", customer: 0, po: "PO-4490", poDateOffset: -45, machine: "Steam Sterilizer", model: "SS-450", qty: 1, price: 980000, engineer: amit, expectedOffset: -3, photos: 6, photosSubmitted: true,
      updates: [
        { dayOffset: -35, stage: "Mechanical Assembly", progress: 30, work: "Chamber and jacket assembled." },
        { dayOffset: -20, stage: "Control Panel / PLC", progress: 65, work: "PLC installed and initial programming completed." },
        { dayOffset: -8, stage: "Testing", progress: 85, work: "Bowie-Dick and vacuum leak tests passed." },
      ],
    },
    { status: "PACKED", customer: 4, po: "CCC-PO-1041", poDateOffset: -50, machine: "Plasma Sterilizer", model: "PS-60", qty: 1, price: 1250000, engineer: rahul, expectedOffset: -8, photos: 5, photosSubmitted: true, updates: [{ dayOffset: -12, stage: "Final Inspection", progress: 95, work: "Final inspection OK." }] },
    { status: "READY_FOR_DISPATCH", customer: 3, po: "LPI/2026/0701", poDateOffset: -60, machine: "Pharmaceutical Autoclave", model: "PA-600L", qty: 1, price: 1750000, engineer: priya, expectedOffset: -15, photos: 8, photosSubmitted: true, updates: [{ dayOffset: -18, stage: "Testing", progress: 85, work: "FAT completed with customer QA." }] },
    { status: "DISPATCHED", customer: 2, po: "MD/PO/2026/199", poDateOffset: -75, machine: "Ultrasonic Cleaner", model: "UC-60", qty: 2, price: 72000, engineer: sanjay, expectedOffset: -30, photos: 4, photosSubmitted: true, updates: [{ dayOffset: -34, stage: "Testing", progress: 85, work: "Tested." }] },
    { status: "ON_HOLD", customer: 1, po: "SMH-PO-7810", poDateOffset: -10, machine: "Instrument Washer", model: "IW-600", qty: 1, price: 520000, engineer: amit, expectedOffset: 18, holdReason: "Customer requested change in chamber size — awaiting revised drawing.", updates: [{ dayOffset: -3, stage: "Material Issued", progress: 5, work: "Material partially issued." }] },
    { status: "PO_UNDER_REVIEW", customer: 0, po: "PO-4587", poDateOffset: -3, machine: "Automatic Washer Disinfector", model: "AWD-500", qty: 2, price: 450000, gmail: { subject: "FW: Purchase Order PO-4587 (resend)", warnings: ["PO date \"04/09/2026\" is ambiguous (read as day/month/year). Please verify."], extraction: "PARTIAL", duplicateOf: 4 } },
  ];

  const created: string[] = [];
  const orderIndex: Record<number, string> = {};
  const numberIndex: Record<number, string | null> = {};
  for (const [i, s] of specs.entries()) {
    const customer = cust[s.customer]!;
    const draft = s.status === "PO_RECEIVED" || s.status === "PO_UNDER_REVIEW";
    const orderNumber = draft ? null : nextNumber();
    const total = s.price * s.qty;
    const workStarted = ["ASSEMBLY_IN_PROGRESS", "TESTING", "COMPLETED", "PHOTOS_UPLOADED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "ON_HOLD"].includes(s.status);
    const completed = ["COMPLETED", "PHOTOS_UPLOADED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED"].includes(s.status);
    const lastUpdate = s.updates?.at(-1);
    const currentStage = completed ? stageByName("Machine Completed") : lastUpdate ? stageByName(lastUpdate.stage) : null;
    const createdAt = at(s.poDateOffset, 10);
    const assignedAt = s.engineer ? at(s.poDateOffset + 1, 11) : null;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        source: s.gmail ? "GMAIL" : i % 3 === 0 ? "MANUAL" : "GMAIL",
        customerId: s.status === "PO_RECEIVED" ? null : customer.id,
        poNumber: s.po,
        poDate: day(s.poDateOffset),
        deliveryDate: s.status === "PO_RECEIVED" ? null : day(s.poDateOffset + 60),
        paymentTerms: "30% advance, balance before dispatch",
        machineName: s.machine,
        machineModel: s.model,
        quantity: s.qty,
        specifications: "SS316L construction; 415V 3-phase; validation documents (IQ/OQ) required.",
        unitPrice: s.price,
        tax: Math.round(total * 0.18),
        totalValue: Math.round(total * 1.18),
        currency: "INR",
        engineerId: s.engineer?.id ?? null,
        status: s.status,
        statusBeforeHold: s.status === "ON_HOLD" ? "ASSEMBLY_IN_PROGRESS" : null,
        holdReason: s.holdReason,
        currentStageId: currentStage?.id,
        progressPercentage: completed ? 100 : lastUpdate?.progress ?? 0,
        expectedCompletionDate: s.expectedOffset !== undefined ? day(s.expectedOffset) : null,
        approvedAt: draft ? null : at(s.poDateOffset, 12),
        assignedAt,
        acceptedAt: s.engineer && s.status !== "ASSIGNED" ? at(s.poDateOffset + 1, 15) : null,
        completedAt: completed ? at((s.expectedOffset ?? 0) - 2, 17) : null,
        completionRemarks: completed ? "All tests passed. Machine ready for packing." : null,
        photosSubmittedAt: s.photosSubmitted ? at((s.expectedOffset ?? 0) - 2, 17, 30) : null,
        lastUpdateAt: lastUpdate ? at(lastUpdate.dayOffset) : assignedAt,
        isDemo: true,
        createdAt,
      },
    });
    created.push(order.id);
    orderIndex[i] = order.id;
    numberIndex[i] = orderNumber;

    const dupTarget = s.gmail?.duplicateOf !== undefined ? orderIndex[s.gmail.duplicateOf] : undefined;
    await prisma.purchaseOrder.create({
      data: {
        orderId: order.id,
        source: order.source,
        gmailMessageId: order.source === "GMAIL" ? `demo-${randomUUID()}` : null,
        sender: order.source === "GMAIL" ? `${customer.contactPerson} <${customer.email}>` : null,
        senderEmail: order.source === "GMAIL" ? customer.email : null,
        subject: s.gmail?.subject ?? (order.source === "GMAIL" ? `Purchase Order ${s.po}` : null),
        receivedAt: createdAt,
        bodyText: order.source === "GMAIL" ? `Dear Sir,\n\nPlease find attached our purchase order ${s.po} for ${s.qty} × ${s.machine} (${s.model}).\n\nRegards,\n${customer.contactPerson}\n${customer.name}\n\n[DEMO DATA]` : null,
        extractionStatus: s.gmail?.extraction ?? (order.source === "GMAIL" ? "SUCCESS" : "MANUAL"),
        extractionWarnings: s.gmail?.warnings ?? [],
        extractedData: s.gmail
          ? {
              fields: {
                poNumber: { value: s.po, confidence: "high", source: `PO No: ${s.po}` },
                machineName: { value: s.machine, confidence: "medium", source: "Item table" },
                quantity: { value: s.qty, confidence: "medium", source: "Item table" },
                customerName: { value: customer.name, confidence: "medium", source: "Bill To block" },
              },
              attachments: [],
              customerMatch: s.status === "PO_RECEIVED" ? null : { id: customer.id, name: customer.name, how: `email domain ${customer.emailDomain}` },
            }
          : undefined,
        duplicateStatus: dupTarget ? "SUSPECTED" : "NONE",
        duplicateReasons: dupTarget ? [`${numberIndex[s.gmail!.duplicateOf!]}: Same PO number (${s.po}) from the same customer`] : [],
        duplicateOfOrderId: dupTarget ?? null,
        createdAt,
      },
    });

    const log = (action: string, summary: string, when: Date, user: { id: string | null; name: string; role: string } = { id: null, name: "System", role: "SYSTEM" }) =>
      prisma.auditLog.create({ data: { action, summary: `${summary}`, orderId: order.id, userId: user.id, userName: user.name, userRole: user.role, createdAt: when } });
    const adminActor = { id: admin.id, name: admin.name, role: "ADMIN" };

    await log(order.source === "GMAIL" ? "PO_IMPORTED" : "ORDER_CREATED", order.source === "GMAIL" ? `PO ${s.po} received from ${customer.name} [demo data]` : `Admin User created order ${orderNumber} manually [demo data]`, createdAt, order.source === "GMAIL" ? undefined : adminActor);
    if (!draft && order.source === "GMAIL") await log("ORDER_APPROVED", `Admin User approved the PO — order ${orderNumber} created`, at(s.poDateOffset, 12), adminActor);
    if (dupTarget) await log("PO_DUPLICATE_FLAGGED", "Possible duplicate PO detected: same PO number from the same customer", createdAt);

    if (draft) continue;
    // Stage rows
    await prisma.orderStageProgress.createMany({ data: stages.map((st) => ({ orderId: order.id, stageId: st.id })) });
    if (s.engineer && assignedAt) {
      await log("ENGINEER_ASSIGNED", `Admin User assigned ${s.engineer.name}`, assignedAt, adminActor);
      if (s.status !== "ASSIGNED") await log("ENGINEER_ACCEPTED", `${s.engineer.name} accepted the order`, at(s.poDateOffset + 1, 15), { id: s.engineer.id, name: s.engineer.name, role: "ENGINEER" });
    }
    let prevStage: string | null = null;
    for (const u of s.updates ?? []) {
      const st = stageByName(u.stage);
      const when = at(u.dayOffset, 18, 30);
      await prisma.dailyUpdate.create({
        data: {
          orderId: order.id,
          engineerId: s.engineer!.id,
          updateDate: day(u.dayOffset),
          stageId: st.id,
          previousStageId: prevStage ? stageByName(prevStage).id : null,
          progress: u.progress,
          workCompleted: u.work,
          issues: u.issue,
          expectedDelayDays: u.delay,
          materialRequired: u.material,
          nextStep: u.next,
          createdAt: when,
        },
      });
      const eng = { id: s.engineer!.id, name: s.engineer!.name, role: "ENGINEER" };
      if (prevStage !== u.stage) await log("STAGE_CHANGED", `${s.engineer!.name} updated stage to ${u.stage}`, when, eng);
      await log("DAILY_UPDATE_ADDED", `${s.engineer!.name} added daily update — ${u.stage}, ${u.progress}%`, when, eng);
      if (u.issue) await log("ISSUE_REPORTED", `${s.engineer!.name} reported an issue: ${u.issue}`, when, eng);
      prevStage = u.stage;
    }
    // Stage progress state
    const reached = completed ? 999 : currentStage?.sequence ?? -1;
    for (const st of stages) {
      if (st.sequence < reached || completed) {
        await prisma.orderStageProgress.update({ where: { orderId_stageId: { orderId: order.id, stageId: st.id } }, data: { status: "COMPLETED", startedAt: at(s.poDateOffset + 2), completedAt: at(s.poDateOffset + 3), updatedById: s.engineer?.id } });
      } else if (st.sequence === reached && workStarted) {
        await prisma.orderStageProgress.update({ where: { orderId_stageId: { orderId: order.id, stageId: st.id } }, data: { status: "IN_PROGRESS", startedAt: at(lastUpdate?.dayOffset ?? 0), notes: lastUpdate?.work, updatedById: s.engineer?.id } });
      }
    }
    // Photos
    for (let p = 0; p < (s.photos ?? 0); p++) {
      const body = await demoPhoto(`${orderNumber} — photo ${p + 1}`, (i * 37 + p * 23) % 360);
      const key = `orders/${order.id}/images/${randomUUID()}.jpg`;
      await storage().put(key, body, "image/jpeg");
      await prisma.orderImage.create({ data: { orderId: order.id, kind: "MACHINE", uploadedById: s.engineer!.id, storageKey: key, fileName: `machine-${p + 1}.jpg`, mimeType: "image/jpeg", size: body.length, width: 1200, height: 900, createdAt: at((s.expectedOffset ?? 0) - 2, 17, 10) } });
    }
    if (completed) await log("MACHINE_COMPLETED", `${s.engineer!.name} marked the machine completed`, order.completedAt!, { id: s.engineer!.id, name: s.engineer!.name, role: "ENGINEER" });
    if (s.photosSubmitted) await log("PHOTOS_SUBMITTED", `${s.engineer!.name} submitted ${s.photos} completion photographs`, order.photosSubmittedAt!, { id: s.engineer!.id, name: s.engineer!.name, role: "ENGINEER" });
    if (["PACKED", "READY_FOR_DISPATCH", "DISPATCHED"].includes(s.status)) {
      const packedAt = at((s.expectedOffset ?? 0) + 1, 11);
      await prisma.dispatch.create({
        data: {
          orderId: order.id,
          packedAt,
          packedById: admin.id,
          packedByName: admin.name,
          packageCount: 2,
          packageDimensions: "180×120×190 cm, 60×40×40 cm",
          weightKg: 640,
          packingRemarks: "Wooden crate, fumigated. [demo]",
          readyAt: s.status !== "PACKED" ? at((s.expectedOffset ?? 0) + 1, 16) : null,
          readyById: s.status !== "PACKED" ? admin.id : null,
          dispatchedAt: s.status === "DISPATCHED" ? day((s.expectedOffset ?? 0) + 3) : null,
          dispatchedById: s.status === "DISPATCHED" ? admin.id : null,
          transporter: s.status === "DISPATCHED" ? "VRL Logistics" : null,
          trackingNumber: s.status === "DISPATCHED" ? "LR-889201" : null,
        },
      });
      await log("PACKED", "Admin User marked the machine packed (2 packages)", packedAt, adminActor);
      if (s.status !== "PACKED") await log("READY_FOR_DISPATCH", "Admin User marked the order READY FOR DISPATCH", at((s.expectedOffset ?? 0) + 1, 16), adminActor);
      if (s.status === "DISPATCHED") await log("DISPATCHED", "Admin User marked the order DISPATCHED via VRL Logistics (AWB/LR LR-889201)", at((s.expectedOffset ?? 0) + 3, 12), adminActor);
    }
    if (s.status === "ON_HOLD") await log("ON_HOLD", `Admin User put the order on hold: ${s.holdReason}`, at(-2, 10), adminActor);
  }
  await prisma.orderSequence.create({ data: { year, lastValue: seq } });

  // A few in-app notifications for the admin
  await prisma.inAppNotification.createMany({
    data: [
      { userId: admin.id, orderId: orderIndex[0], type: "PO_RECEIVED", title: "New PO received — PO requires review", message: "MD/PO/2026/318 from Metro Diagnostics Ltd · delivery date could not be identified", link: `/purchase-orders/${orderIndex[0]}` },
      { userId: admin.id, orderId: orderIndex[13], type: "PO_RECEIVED", title: "Possible duplicate PO detected", message: "PO-4587 from ABC Hospital Pvt Ltd", link: `/purchase-orders/${orderIndex[13]}` },
      { userId: admin.id, orderId: orderIndex[5], type: "ISSUE_REPORTED", title: "⚠️ Issue on order", message: "Amit Patel: Waiting for 2 connectors from supplier.", link: `/orders/${orderIndex[5]}` },
      { userId: rahul.id, orderId: orderIndex[2], type: "ORDER_ASSIGNED", title: "New order assigned", message: "Lotus Pharma Industries — Pharmaceutical Autoclave. Please review and accept.", link: `/orders/${orderIndex[2]}` },
    ],
  });

  console.log(`
✔ Demo data created (${created.length} orders, 5 customers, 4 engineers).
  Admin:     admin@demo.local / ${ADMIN_PASSWORD}
  Engineers: rahul@demo.local, priya@demo.local, amit@demo.local, sanjay@demo.local / ${ENGINEER_PASSWORD}
  All demo records are flagged is_demo = true.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
