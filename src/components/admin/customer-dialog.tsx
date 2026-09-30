"use client";

import { Dialog, useDialog } from "@/components/ui/dialog";
import { ActionForm, FormField, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { Input, Textarea } from "@/components/ui/form";

interface CustomerValues {
  name?: string;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
}

function CustomerForm({ action, values }: { action: FormAction; values: CustomerValues }) {
  const { close } = useDialog();
  return (
    <ActionForm action={action} onSuccess={() => setTimeout(close, 600)} className="grid gap-3 sm:grid-cols-2">
      <FormField name="name" label="Customer name" required className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={values.name ?? ""} required />
      </FormField>
      <FormField name="contactPerson" label="Contact person">
        <Input id="contactPerson" name="contactPerson" defaultValue={values.contactPerson ?? ""} />
      </FormField>
      <FormField name="phone" label="Phone">
        <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
      </FormField>
      <FormField name="email" label="Email" hint="Its domain is used to match incoming PO emails" className="sm:col-span-2">
        <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
      </FormField>
      <FormField name="billingAddress" label="Billing address">
        <Textarea id="billingAddress" name="billingAddress" rows={3} defaultValue={values.billingAddress ?? ""} />
      </FormField>
      <FormField name="shippingAddress" label="Shipping address">
        <Textarea id="shippingAddress" name="shippingAddress" rows={3} defaultValue={values.shippingAddress ?? ""} />
      </FormField>
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton>Save customer</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CustomerDialog({ action, values = {}, trigger, isNew }: { action: FormAction; values?: CustomerValues; trigger: string; isNew?: boolean }) {
  return (
    <Dialog trigger={trigger} title={isNew ? "Add customer" : `Edit ${values.name}`} wide triggerProps={{ variant: isNew ? "primary" : "secondary", size: isNew ? "md" : "sm" }}>
      <CustomerForm action={action} values={values} />
    </Dialog>
  );
}
