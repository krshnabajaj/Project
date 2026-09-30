"use client";

import * as React from "react";
import { ActionForm, ActionButton, FormField, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form";
import type { ActionState } from "@/lib/action-state";
import type { ButtonProps } from "@/components/ui/button";

export interface EngineerOption {
  id: string;
  name: string;
  openLoad: number;
  overdue: number;
}

/** Dialog containing an ActionForm that closes itself after success. */
function DialogForm({ action, children, submit, confirm, variant }: { action: FormAction; children?: React.ReactNode; submit: string; confirm?: string; variant?: ButtonProps["variant"] }) {
  const { close } = useDialog();
  return (
    <ActionForm action={action} onSuccess={() => setTimeout(close, 600)} confirm={confirm} className="space-y-3">
      {children}
      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton variant={variant}>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AssignDialog({
  action,
  engineers,
  currentEngineerId,
  expected,
  reassign,
  minDate,
}: {
  action: FormAction;
  engineers: EngineerOption[];
  currentEngineerId?: string | null;
  expected?: string | null;
  reassign?: boolean;
  minDate: string;
}) {
  return (
    <Dialog
      trigger={reassign ? "Reassign engineer" : "Assign engineer"}
      title={reassign ? "Reassign engineer" : "Assign engineer"}
      description="The engineer is notified in the app (and on WhatsApp when a phone number is set)."
      triggerProps={{ variant: reassign ? "secondary" : "primary" }}
    >
      <DialogForm action={action} submit={reassign ? "Reassign" : "Assign"}>
        <FormField name="engineerId" label="Engineer" required>
          <Select name="engineerId" id="engineerId" defaultValue="" required>
            <option value="" disabled>
              Select engineer…
            </option>
            {engineers.map((e) => (
              <option key={e.id} value={e.id} disabled={e.id === currentEngineerId}>
                {e.name} — {e.openLoad} open{e.overdue ? `, ${e.overdue} overdue` : ""}
                {e.id === currentEngineerId ? " (current)" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="rounded-md bg-surface-2 p-3 text-xs">
          <div className="mb-1.5 font-medium text-muted">Current workload (open orders)</div>
          <ul className="space-y-1">
            {engineers.map((e) => {
              const max = Math.max(1, ...engineers.map((x) => x.openLoad));
              return (
                <li key={e.id} className="flex items-center gap-2" title={`${e.name}: ${e.openLoad} open, ${e.overdue} overdue`}>
                  <span className="w-28 truncate">{e.name}</span>
                  <span className="h-2 flex-1 rounded-sm bg-bar-track">
                    <span className="block h-full rounded-sm bg-bar" style={{ width: `${(e.openLoad / max) * 100}%` }} />
                  </span>
                  <span className="tabular w-16 text-right text-muted">
                    {e.openLoad}
                    {e.overdue ? <span className="text-[var(--tone-danger-fg)]"> · {e.overdue}!</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <FormField name="expectedCompletionDate" label="Expected completion date" hint="Drives overdue tracking. Leave blank to keep the current date.">
          <Input type="date" id="expectedCompletionDate" name="expectedCompletionDate" defaultValue={expected ?? ""} min={minDate} />
        </FormField>
      </DialogForm>
    </Dialog>
  );
}

export function ReasonDialog({ action, trigger, title, submit, variant, placeholder }: { action: FormAction; trigger: string; title: string; submit: string; variant?: ButtonProps["variant"]; placeholder?: string }) {
  return (
    <Dialog trigger={trigger} title={title} triggerProps={{ variant: variant === "danger" ? "ghost" : "secondary" }}>
      <DialogForm action={action} submit={submit} variant={variant}>
        <FormField name="reason" label="Reason" required>
          <Textarea name="reason" id="reason" rows={3} required placeholder={placeholder} maxLength={1000} />
        </FormField>
      </DialogForm>
    </Dialog>
  );
}

export function PackDialog({ action, adminName }: { action: FormAction; adminName: string }) {
  return (
    <Dialog trigger="Mark as packed" title="Mark machine as packed" triggerProps={{ variant: "primary" }}>
      <DialogForm action={action} submit="Mark as packed">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField name="packedByName" label="Packed by">
            <Input name="packedByName" id="packedByName" defaultValue={adminName} />
          </FormField>
          <FormField name="packageCount" label="Number of packages">
            <Input name="packageCount" id="packageCount" type="number" min={1} />
          </FormField>
          <FormField name="packageDimensions" label="Package dimensions" hint="Optional, e.g. 120×80×150 cm">
            <Input name="packageDimensions" id="packageDimensions" />
          </FormField>
          <FormField name="weightKg" label="Weight (kg)" hint="Optional">
            <Input name="weightKg" id="weightKg" inputMode="decimal" />
          </FormField>
          <FormField name="packingRemarks" label="Packing remarks" className="sm:col-span-2">
            <Textarea name="packingRemarks" id="packingRemarks" rows={2} />
          </FormField>
        </div>
      </DialogForm>
    </Dialog>
  );
}

export function DispatchDialog({ action, today }: { action: FormAction; today: string }) {
  return (
    <Dialog trigger="Mark dispatched" title="Mark order dispatched" triggerProps={{ variant: "primary" }}>
      <DialogForm action={action} submit="Mark dispatched">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField name="dispatchedAt" label="Dispatch date" required>
            <Input type="date" name="dispatchedAt" id="dispatchedAt" defaultValue={today} max={today} />
          </FormField>
          <FormField name="courier" label="Courier">
            <Input name="courier" id="courier" placeholder="e.g. Blue Dart" />
          </FormField>
          <FormField name="transporter" label="Transporter">
            <Input name="transporter" id="transporter" placeholder="e.g. VRL Logistics" />
          </FormField>
          <FormField name="trackingNumber" label="AWB / LR number">
            <Input name="trackingNumber" id="trackingNumber" />
          </FormField>
          <FormField name="vehicleNumber" label="Vehicle number">
            <Input name="vehicleNumber" id="vehicleNumber" />
          </FormField>
          <FormField name="dispatchRemarks" label="Dispatch remarks" className="sm:col-span-2">
            <Textarea name="dispatchRemarks" id="dispatchRemarks" rows={2} />
          </FormField>
        </div>
      </DialogForm>
    </Dialog>
  );
}

/** One-click workflow step (form with just a submit button). */
export function StepButton({ action, children, confirm, variant = "primary", size = "md" }: { action: FormAction; children: React.ReactNode; confirm?: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  return (
    <ActionForm action={action} confirm={confirm}>
      <SubmitButton variant={variant} size={size} pendingText="Working…">
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2" showSuccess={false}>
      <Textarea name="body" rows={2} placeholder="Add an internal note…" maxLength={2000} required aria-label="Note" />
      <div className="flex justify-end">
        <SubmitButton size="sm">Add note</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RetryButton({ run }: { run: () => Promise<ActionState> }) {
  return (
    <ActionButton size="sm" variant="secondary" run={run}>
      Retry
    </ActionButton>
  );
}
