import type { Order } from "@prisma/client";
import { toIsoDate } from "@/lib/utils";
import type { OrderFormValues } from "./order-form";

/** Serialize an order row into plain form defaults (Decimals/Dates → strings). */
export function orderFormValues(o: Order): OrderFormValues {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    customerId: o.customerId,
    poNumber: o.poNumber,
    poDate: toIsoDate(o.poDate) || null,
    deliveryDate: toIsoDate(o.deliveryDate) || null,
    paymentTerms: o.paymentTerms,
    referenceNumber: o.referenceNumber,
    machineName: o.machineName,
    machineModel: o.machineModel,
    quantity: o.quantity,
    specifications: o.specifications,
    specialInstructions: o.specialInstructions,
    unitPrice: s(o.unitPrice),
    totalValue: s(o.totalValue),
    tax: s(o.tax),
    currency: o.currency,
    expectedCompletionDate: toIsoDate(o.expectedCompletionDate) || null,
  };
}
