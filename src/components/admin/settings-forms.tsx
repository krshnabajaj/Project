"use client";

import { ActionForm, ActionButton, FormField, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, useDialog } from "@/components/ui/dialog";
import type { ActionState } from "@/lib/action-state";

export function CompanyForm({ action, v }: { action: FormAction; v: Record<string, string> }) {
  return (
    <ActionForm action={action} className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <FormField name="name" label="Company name" className="sm:col-span-2">
        <Input name="name" id="name" defaultValue={v.name} />
      </FormField>
      <FormField name="address" label="Address" className="sm:col-span-2">
        <Textarea name="address" id="address" rows={2} defaultValue={v.address} />
      </FormField>
      <FormField name="phone" label="Phone">
        <Input name="phone" id="phone" defaultValue={v.phone} />
      </FormField>
      <FormField name="email" label="Email">
        <Input name="email" id="email" defaultValue={v.email} />
      </FormField>
      <FormField name="website" label="Website">
        <Input name="website" id="website" defaultValue={v.website} />
      </FormField>
      <FormField name="logoUrl" label="Logo URL" hint="Public https URL of your logo (optional)">
        <Input name="logoUrl" id="logoUrl" defaultValue={v.logoUrl} />
      </FormField>
      <div className="sm:col-span-2">
        <SubmitButton>Save company</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function WhatsAppForm({
  action,
  v,
  types,
  test,
}: {
  action: FormAction;
  v: { adminNumber: string; enabledTypes: string[]; notifyEngineerOnAssignment: boolean };
  types: Record<string, string>;
  test: () => Promise<ActionState>;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <ActionForm action={action} className="space-y-4">
        <FormField name="adminNumber" label="Admin WhatsApp number" hint="International format, e.g. +919876543210">
          <Input name="adminNumber" id="adminNumber" defaultValue={v.adminNumber} placeholder="+91…" />
        </FormField>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Send WhatsApp notifications for</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(types).map(([key, label]) => (
              <Checkbox key={key} name="enabledTypes" value={key} defaultChecked={v.enabledTypes.includes(key)} label={label} />
            ))}
          </div>
        </fieldset>
        <Checkbox name="notifyEngineerOnAssignment" defaultChecked={v.notifyEngineerOnAssignment} label="Also message the engineer (on their phone) when an order is assigned" />
        <SubmitButton>Save WhatsApp settings</SubmitButton>
      </ActionForm>
      <ActionButton variant="secondary" run={test}>
        Send test WhatsApp to admin
      </ActionButton>
    </div>
  );
}

export function EmailForm({
  action,
  v,
  test,
}: {
  action: FormAction;
  v: { adminEmail: string; completionRecipients: string[]; ccRecipients: string[]; attachPhotos: boolean };
  test: () => Promise<ActionState>;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <ActionForm action={action} className="space-y-3">
        <FormField name="adminEmail" label="Admin email">
          <Input name="adminEmail" id="adminEmail" type="email" defaultValue={v.adminEmail} />
        </FormField>
        <FormField name="completionRecipients" label="Completion email recipients" hint="One per line or comma-separated. Defaults to the admin email when empty.">
          <Textarea name="completionRecipients" id="completionRecipients" rows={2} defaultValue={v.completionRecipients.join("\n")} />
        </FormField>
        <FormField name="ccRecipients" label="CC recipients">
          <Textarea name="ccRecipients" id="ccRecipients" rows={2} defaultValue={v.ccRecipients.join("\n")} />
        </FormField>
        <Checkbox name="attachPhotos" defaultChecked={v.attachPhotos} label="Attach machine photographs to the completion email" />
        <div>
          <SubmitButton>Save email settings</SubmitButton>
        </div>
      </ActionForm>
      <ActionButton variant="secondary" run={test}>
        Send test email
      </ActionButton>
    </div>
  );
}

export function GmailRulesForm({
  action,
  v,
}: {
  action: FormAction;
  v: { enabled: boolean; subjectKeywords: string[]; senderAllowlist: string[]; label: string; attachmentTypes: string[]; requireAttachment: boolean; lookbackDays: number; extraQuery: string };
}) {
  return (
    <ActionForm action={action} className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <Checkbox name="enabled" defaultChecked={v.enabled} label="Automatically import POs from Gmail" className="sm:col-span-2" />
      <FormField name="subjectKeywords" label="Subject keywords" hint="One per line — any match qualifies">
        <Textarea name="subjectKeywords" id="subjectKeywords" rows={4} defaultValue={v.subjectKeywords.join("\n")} />
      </FormField>
      <FormField name="senderAllowlist" label="Only from senders / domains" hint="Optional. e.g. purchase@abc.com or @abchospital.com">
        <Textarea name="senderAllowlist" id="senderAllowlist" rows={4} defaultValue={v.senderAllowlist.join("\n")} />
      </FormField>
      <FormField name="label" label="Gmail label / folder" hint="Optional. Only search this label.">
        <Input name="label" id="label" defaultValue={v.label} />
      </FormField>
      <FormField name="lookbackDays" label="Look back (days)">
        <Input name="lookbackDays" id="lookbackDays" type="number" min={1} max={90} defaultValue={v.lookbackDays} />
      </FormField>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-xs font-medium text-muted">Attachment types to import</legend>
        <div className="flex flex-wrap gap-4">
          {[
            ["pdf", "PDF"],
            ["excel", "Excel"],
            ["word", "Word"],
            ["image", "Images"],
          ].map(([k, l]) => (
            <Checkbox key={k} name="attachmentTypes" value={k} defaultChecked={v.attachmentTypes.includes(k)} label={l} />
          ))}
        </div>
      </fieldset>
      <Checkbox name="requireAttachment" defaultChecked={v.requireAttachment} label="Skip emails without a PO attachment" className="sm:col-span-2" />
      <FormField name="extraQuery" label="Additional Gmail search terms" hint="Advanced, e.g. -from:noreply@vendor.com" className="sm:col-span-2">
        <Input name="extraQuery" id="extraQuery" defaultValue={v.extraQuery} />
      </FormField>
      <div className="sm:col-span-2">
        <SubmitButton>Save PO rules</SubmitButton>
      </div>
    </ActionForm>
  );
}

function StageForm({ action, v }: { action: FormAction; v?: { name: string; phase: string; defaultProgress: number; active: boolean } }) {
  const { close } = useDialog();
  return (
    <ActionForm action={action} onSuccess={() => setTimeout(close, 500)} className="space-y-3">
      <FormField name="name" label="Stage name" required>
        <Input name="name" id="name" defaultValue={v?.name} required />
      </FormField>
      <FormField name="phase" label="Phase" hint="Testing-phase stages move the order to TESTING. The final stage is reached by “Mark completed”.">
        <Select name="phase" id="phase" defaultValue={v?.phase ?? "ASSEMBLY"}>
          <option value="ASSEMBLY">Assembly</option>
          <option value="TESTING">Testing / inspection</option>
          <option value="FINAL">Final (machine completed)</option>
        </Select>
      </FormField>
      <FormField name="defaultProgress" label="Suggested progress % when entering this stage">
        <Input name="defaultProgress" id="defaultProgress" type="number" min={0} max={100} defaultValue={v?.defaultProgress ?? 0} />
      </FormField>
      {v && <Checkbox name="active" defaultChecked={v.active} label="Active" />}
      <SubmitButton>{v ? "Save stage" : "Add stage"}</SubmitButton>
    </ActionForm>
  );
}

export function StageDialog({ action, v, trigger }: { action: FormAction; v?: { name: string; phase: string; defaultProgress: number; active: boolean }; trigger: string }) {
  return (
    <Dialog trigger={trigger} title={v ? `Edit stage “${v.name}”` : "Add assembly stage"} triggerProps={{ size: "sm", variant: v ? "secondary" : "primary" }}>
      <StageForm action={action} v={v} />
    </Dialog>
  );
}

export function MoveButtons({ up, down }: { up?: () => Promise<ActionState>; down?: () => Promise<ActionState> }) {
  return (
    <span className="inline-flex gap-1">
      {up && (
        <ActionButton size="sm" variant="ghost" run={up} aria-label="Move up">
          ↑
        </ActionButton>
      )}
      {down && (
        <ActionButton size="sm" variant="ghost" run={down} aria-label="Move down">
          ↓
        </ActionButton>
      )}
    </span>
  );
}
