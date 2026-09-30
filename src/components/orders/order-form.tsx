"use client";

import * as React from "react";
import { ActionForm, FormField, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import type { ActionState } from "@/lib/action-state";
import Link from "next/link";

export interface OrderFormValues {
  customerId?: string | null;
  poNumber?: string | null;
  poDate?: string | null;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
  machineName?: string | null;
  machineModel?: string | null;
  quantity?: number | null;
  specifications?: string | null;
  specialInstructions?: string | null;
  unitPrice?: string | null;
  totalValue?: string | null;
  tax?: string | null;
  currency?: string | null;
  expectedCompletionDate?: string | null;
  newCustomer?: { name?: string | null; billingAddress?: string | null; shippingAddress?: string | null; contactPerson?: string | null; email?: string | null; phone?: string | null };
}

type Confidence = Record<string, { confidence: "high" | "medium" | "low"; source: string } | undefined>;

function ConfidenceHint({ c }: { c?: { confidence: "high" | "medium" | "low"; source: string } }) {
  if (!c) return null;
  const tone = c.confidence === "high" ? "success" : c.confidence === "medium" ? "info" : "warning";
  return (
    <Badge tone={tone} className="ml-1 normal-case" title={`Extracted from: ${c.source}`}>
      {c.confidence === "low" ? "verify" : `auto · ${c.confidence}`}
    </Badge>
  );
}

function Duplicates({ state }: { state: ActionState }) {
  const dups = (state.data as { duplicates?: { orderId: string; orderNumber: string | null; customerName: string | null; reasons: string[] }[] } | undefined)?.duplicates;
  if (!dups?.length) return null;
  return (
    <Alert tone="warning" title="Possible duplicate PO detected." className="mt-3">
      <ul className="list-disc pl-4">
        {dups.map((d) => (
          <li key={d.orderId}>
            <Link href={`/orders/${d.orderId}`} target="_blank">
              {d.orderNumber ?? "Draft"}
            </Link>{" "}
            {d.customerName ? `(${d.customerName})` : ""} — {d.reasons.join("; ")}
          </li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 font-medium">
        <input type="checkbox" name="allowDuplicate" value="1" /> This is a separate order — create anyway
      </label>
    </Alert>
  );
}

export function OrderForm({
  action,
  customers,
  values = {},
  confidence = {},
  submitLabel,
  showExpected = true,
}: {
  action: FormAction;
  customers: { id: string; name: string }[];
  values?: OrderFormValues;
  confidence?: Confidence;
  submitLabel: string;
  showExpected?: boolean;
}) {
  const [mode, setMode] = React.useState<"existing" | "new">(values.customerId || !values.newCustomer?.name ? "existing" : "new");
  const v = values;
  const nc = v.newCustomer ?? {};
  const label = (text: string, key: string) => (
    <>
      {text}
      <ConfidenceHint c={confidence[key]} />
    </>
  );
  return (
    <ActionForm
      action={action}
      className="space-y-6"
      renderState={(s) => (
        <>
          {s.error && !(s.data as { duplicates?: unknown[] } | undefined)?.duplicates && <Alert tone="danger" className="mt-3">{s.error}</Alert>}
          <Duplicates state={s} />
          <div className="mt-4 flex justify-end">
            <SubmitButton size="lg">{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    >
      <input type="hidden" name="customerMode" value={mode} />
      <section>
        <h3 className="mb-3 text-sm font-semibold">Customer information</h3>
        <div className="mb-3 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-[var(--primary)]" /> Existing customer
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} className="accent-[var(--primary)]" /> New customer
          </label>
        </div>
        {mode === "existing" ? (
          <FormField name="customerId" label="Customer" required>
            <Select id="customerId" name="customerId" defaultValue={v.customerId ?? ""}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField name="newCustomer.name" label={label("Customer name", "customerName")} required>
              <Input id="newCustomer.name" name="newCustomer.name" defaultValue={nc.name ?? ""} maxLength={150} />
            </FormField>
            <FormField name="newCustomer.contactPerson" label={label("Contact person", "contactPerson")}>
              <Input id="newCustomer.contactPerson" name="newCustomer.contactPerson" defaultValue={nc.contactPerson ?? ""} />
            </FormField>
            <FormField name="newCustomer.email" label={label("Email", "email")}>
              <Input id="newCustomer.email" name="newCustomer.email" type="email" defaultValue={nc.email ?? ""} />
            </FormField>
            <FormField name="newCustomer.phone" label={label("Phone", "phone")}>
              <Input id="newCustomer.phone" name="newCustomer.phone" defaultValue={nc.phone ?? ""} />
            </FormField>
            <FormField name="newCustomer.billingAddress" label={label("Billing address", "billingAddress")}>
              <Textarea id="newCustomer.billingAddress" name="newCustomer.billingAddress" rows={2} defaultValue={nc.billingAddress ?? ""} />
            </FormField>
            <FormField name="newCustomer.shippingAddress" label={label("Shipping address", "shippingAddress")}>
              <Textarea id="newCustomer.shippingAddress" name="newCustomer.shippingAddress" rows={2} defaultValue={nc.shippingAddress ?? ""} />
            </FormField>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">PO information</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField name="poNumber" label={label("PO number", "poNumber")} required>
            <Input id="poNumber" name="poNumber" defaultValue={v.poNumber ?? ""} maxLength={60} />
          </FormField>
          <FormField name="poDate" label={label("PO date", "poDate")}>
            <Input id="poDate" name="poDate" type="date" defaultValue={v.poDate ?? ""} />
          </FormField>
          <FormField name="deliveryDate" label={label("Delivery date", "deliveryDate")}>
            <Input id="deliveryDate" name="deliveryDate" type="date" defaultValue={v.deliveryDate ?? ""} />
          </FormField>
          <FormField name="paymentTerms" label={label("Payment terms", "paymentTerms")}>
            <Input id="paymentTerms" name="paymentTerms" defaultValue={v.paymentTerms ?? ""} />
          </FormField>
          <FormField name="referenceNumber" label={label("Reference number", "referenceNumber")}>
            <Input id="referenceNumber" name="referenceNumber" defaultValue={v.referenceNumber ?? ""} />
          </FormField>
          {showExpected && (
            <FormField name="expectedCompletionDate" label="Expected completion (internal)" hint="Used for overdue tracking">
              <Input id="expectedCompletionDate" name="expectedCompletionDate" type="date" defaultValue={v.expectedCompletionDate ?? ""} />
            </FormField>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Machine information</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField name="machineName" label={label("Machine / product", "machineName")} required className="lg:col-span-2">
            <Input id="machineName" name="machineName" defaultValue={v.machineName ?? ""} maxLength={200} />
          </FormField>
          <FormField name="quantity" label={label("Quantity", "quantity")} required>
            <Input id="quantity" name="quantity" type="number" min={1} defaultValue={v.quantity ?? ""} />
          </FormField>
          <FormField name="machineModel" label={label("Model number", "machineModel")}>
            <Input id="machineModel" name="machineModel" defaultValue={v.machineModel ?? ""} />
          </FormField>
          <FormField name="specifications" label={label("Specifications", "specifications")} className="sm:col-span-2">
            <Textarea id="specifications" name="specifications" rows={2} defaultValue={v.specifications ?? ""} />
          </FormField>
          <FormField name="specialInstructions" label={label("Special instructions", "specialInstructions")} className="sm:col-span-2 lg:col-span-3">
            <Textarea id="specialInstructions" name="specialInstructions" rows={2} defaultValue={v.specialInstructions ?? ""} />
          </FormField>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Commercial information</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField name="unitPrice" label={label("Unit price", "unitPrice")}>
            <Input id="unitPrice" name="unitPrice" inputMode="decimal" defaultValue={v.unitPrice ?? ""} />
          </FormField>
          <FormField name="tax" label={label("Tax", "tax")}>
            <Input id="tax" name="tax" inputMode="decimal" defaultValue={v.tax ?? ""} />
          </FormField>
          <FormField name="totalValue" label={label("Total value", "totalValue")}>
            <Input id="totalValue" name="totalValue" inputMode="decimal" defaultValue={v.totalValue ?? ""} />
          </FormField>
          <FormField name="currency" label={label("Currency", "currency")} hint="3-letter code, e.g. INR">
            <Input id="currency" name="currency" maxLength={3} defaultValue={v.currency ?? ""} className="uppercase" />
          </FormField>
        </div>
      </section>
    </ActionForm>
  );
}
