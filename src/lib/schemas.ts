import { z } from "zod";

/** Empty strings from HTML forms become undefined/null. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const optText = (max = 500) =>
  z.preprocess(blank, z.string().trim().max(max).optional().nullable()).transform((v) => v ?? null);
export const reqText = (label: string, max = 500) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
export const optDate = z
  .preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().nullable())
  .transform((v) => v ?? null);
export const optInt = (min = 0, max = 100000) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).optional().nullable()).transform((v) => v ?? null);
export const optMoney = z
  .preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.replace(/,/g, "")) : v),
    z.coerce.number().min(0).max(1e12).optional().nullable(),
  )
  .transform((v) => v ?? null);
export const optEmail = z
  .preprocess(blank, z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")).optional().nullable())
  .transform((v) => v ?? null);
export const optPhone = z
  .preprocess(blank, z.string().trim().regex(/^\+?[0-9\s\-()]{7,20}$/, "Enter a valid phone number").optional().nullable())
  .transform((v) => v ?? null);

export const customerInputSchema = z.object({
  name: reqText("Customer name", 150),
  billingAddress: optText(500),
  shippingAddress: optText(500),
  contactPerson: optText(100),
  email: optEmail,
  phone: optPhone,
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const orderFieldsSchema = z.object({
  poNumber: optText(60),
  poDate: optDate,
  deliveryDate: optDate,
  paymentTerms: optText(200),
  referenceNumber: optText(60),
  machineName: optText(200),
  machineModel: optText(100),
  quantity: optInt(1, 10000),
  specifications: optText(4000),
  specialInstructions: optText(4000),
  unitPrice: optMoney,
  totalValue: optMoney,
  tax: optMoney,
  currency: z
    .preprocess(blank, z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").optional().nullable())
    .transform((v) => v ?? null),
  expectedCompletionDate: optDate,
});
export type OrderFieldsInput = z.infer<typeof orderFieldsSchema>;

/** Order form: fields + either an existing customer or a new one. */
export const orderInputSchema = orderFieldsSchema.extend({
  customerId: optText(40),
  newCustomer: customerInputSchema.optional().nullable(),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

export const dailyUpdateSchema = z.object({
  stageId: reqText("Stage", 40),
  progress: z.coerce.number({ error: "Progress is required" }).int().min(0, "0–100").max(100, "0–100"),
  workCompleted: reqText("Work completed today", 2000),
  issues: optText(2000),
  expectedDelayDays: optInt(0, 365),
  materialRequired: optText(1000),
  nextStep: optText(1000),
  expectedCompletion: optDate,
  stageCompleted: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
  updateDate: optDate,
});
export type DailyUpdateInput = z.infer<typeof dailyUpdateSchema>;

export const packingSchema = z.object({
  packedByName: optText(100),
  packingRemarks: optText(1000),
  packageCount: optInt(1, 1000),
  packageDimensions: optText(200),
  weightKg: optMoney,
});
export type PackingInput = z.infer<typeof packingSchema>;

export const dispatchSchema = z.object({
  dispatchedAt: optDate,
  courier: optText(100),
  transporter: optText(100),
  trackingNumber: optText(100),
  vehicleNumber: optText(40),
  dispatchRemarks: optText(1000),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const userInputSchema = z.object({
  name: reqText("Name", 100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: optPhone,
  role: z.enum(["ADMIN", "ENGINEER"]),
});
