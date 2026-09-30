"use client";

import { Dialog, useDialog } from "@/components/ui/dialog";
import { ActionForm, ActionButton, FormField, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/lib/action-state";

interface UserValues {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: "ADMIN" | "ENGINEER";
}

function UserForm({ action, values, isNew }: { action: FormAction; values: UserValues; isNew: boolean }) {
  const { close } = useDialog();
  return (
    <ActionForm action={action} onSuccess={() => setTimeout(close, 600)} className="space-y-3">
      <FormField name="name" label="Full name" required>
        <Input id="name" name="name" defaultValue={values.name ?? ""} required />
      </FormField>
      <FormField name="email" label="Email (login)" required>
        <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} required />
      </FormField>
      <FormField name="phone" label="WhatsApp number" hint="International format, e.g. +919876543210 — used for assignment alerts">
        <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
      </FormField>
      <FormField name="role" label="Role">
        <Select id="role" name="role" defaultValue={values.role ?? "ENGINEER"}>
          <option value="ENGINEER">Engineer</option>
          <option value="ADMIN">Admin</option>
        </Select>
      </FormField>
      <FormField name="password" label={isNew ? "Initial password" : "New password"} hint={isNew ? "At least 10 characters with a letter and a number" : "Leave blank to keep the current password"} required={isNew}>
        <Input id="password" name="password" type="password" autoComplete="new-password" />
      </FormField>
      <div className="flex justify-end">
        <SubmitButton>{isNew ? "Create user" : "Save"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UserDialog({ action, values = {}, trigger, isNew = false }: { action: FormAction; values?: UserValues; trigger: string; isNew?: boolean }) {
  return (
    <Dialog trigger={trigger} title={isNew ? "Add user" : `Edit ${values.name}`} triggerProps={{ variant: isNew ? "primary" : "secondary", size: isNew ? "md" : "sm" }}>
      <UserForm action={action} values={values} isNew={isNew} />
    </Dialog>
  );
}

export function ToggleActive({ run, active }: { run: () => Promise<ActionState>; active: boolean }) {
  return (
    <ActionButton size="sm" variant={active ? "ghost" : "secondary"} run={run} confirm={active ? "Deactivate this user? They will be signed out and cannot log in." : undefined}>
      {active ? "Deactivate" : "Activate"}
    </ActionButton>
  );
}
