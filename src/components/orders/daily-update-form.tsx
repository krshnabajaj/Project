"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { ACCEPT_IMAGES, compressImage, validImage } from "./image-utils";

interface Stage {
  id: string;
  name: string;
  defaultProgress: number;
}

/**
 * Mobile-first end-of-day update:
 * Stage → Progress → What was done → Issues → Photos → Submit.
 */
export function DailyUpdateForm({
  orderId,
  stages,
  currentStageId,
  currentProgress,
  today,
  maxPhotos,
}: {
  orderId: string;
  stages: Stage[];
  currentStageId: string | null;
  currentProgress: number;
  today: string;
  maxPhotos: number;
}) {
  const router = useRouter();
  const [stageId, setStageId] = React.useState(currentStageId ?? stages[0]?.id ?? "");
  const [progress, setProgress] = React.useState(currentProgress);
  const [hasIssue, setHasIssue] = React.useState(false);
  const [photos, setPhotos] = React.useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onStage = (id: string) => {
    setStageId(id);
    const s = stages.find((x) => x.id === id);
    if (s && s.defaultProgress > progress) setProgress(s.defaultProgress);
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const ok = Array.from(files).filter(validImage).slice(0, maxPhotos - photos.length);
    const compressed = await Promise.all(ok.map((f) => compressImage(f)));
    setPhotos((p) => [...p, ...compressed.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    const errs: Record<string, string> = {};
    if (!String(fd.get("workCompleted") ?? "").trim()) errs.workCompleted = "Describe the work completed today";
    if (hasIssue && !String(fd.get("issues") ?? "").trim()) errs.issues = "Describe the issue or untick “Report an issue”";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    if (!hasIssue) {
      fd.delete("issues");
      fd.delete("expectedDelayDays");
    }
    photos.forEach((p) => fd.append("photos", p.file, p.file.name));
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/updates`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Update failed (${res.status})`);
      router.push(`/orders/${orderId}?updated=1`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Current stage" htmlFor="stageId" required>
        <Select id="stageId" name="stageId" value={stageId} onChange={(e) => onStage(e.target.value)} className="h-12 text-base">
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox name="stageCompleted" label="This stage is finished today" />

      <Field label={`Overall progress: ${progress}%`} htmlFor="progress" required>
        <div className="flex items-center gap-3">
          <input
            id="progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="h-10 flex-1 accent-[var(--primary)]"
          />
          <Input name="progress" type="number" inputMode="numeric" min={0} max={100} value={progress} onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-12 w-20 text-center text-base" aria-label="Progress percent" />
        </div>
      </Field>

      <Field label="Work completed today" htmlFor="workCompleted" required error={fieldErrors.workCompleted}>
        <Textarea id="workCompleted" name="workCompleted" rows={3} className="text-base" placeholder="e.g. Control panel wiring completed." maxLength={2000} />
      </Field>

      <div className="rounded-md border border-border p-3">
        <Checkbox checked={hasIssue} onChange={(e) => setHasIssue(e.target.checked)} label={<span className="font-medium">Report an issue / blocker</span>} />
        {hasIssue && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Issue" htmlFor="issues" error={fieldErrors.issues}>
              <Textarea id="issues" name="issues" rows={2} className="text-base" placeholder="e.g. Waiting for PLC module" maxLength={2000} />
            </Field>
            <Field label="Expected delay (days)" htmlFor="expectedDelayDays">
              <Input id="expectedDelayDays" name="expectedDelayDays" type="number" inputMode="numeric" min={0} max={365} className="h-12 text-base" />
            </Field>
          </div>
        )}
      </div>

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">More details (material, next step, dates)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Material required" htmlFor="materialRequired" className="sm:col-span-2">
            <Input id="materialRequired" name="materialRequired" maxLength={1000} placeholder="e.g. 2 × M12 connectors" />
          </Field>
          <Field label="Expected next step" htmlFor="nextStep" className="sm:col-span-2">
            <Input id="nextStep" name="nextStep" maxLength={1000} placeholder="e.g. PLC wiring" />
          </Field>
          <Field label="Estimated completion date" htmlFor="expectedCompletion">
            <Input id="expectedCompletion" name="expectedCompletion" type="date" min={today} />
          </Field>
          <Field label="Update date" htmlFor="updateDate" hint="Defaults to today">
            <Input id="updateDate" name="updateDate" type="date" max={today} defaultValue={today} />
          </Field>
        </div>
      </details>

      <div>
        <div className="mb-2 text-xs font-medium text-muted">Progress photos (optional, up to {maxPhotos})</div>
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.url} className="relative size-20 overflow-hidden rounded border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Progress photo preview" className="size-full object-cover" />
              <button type="button" className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-1 text-white" onClick={() => setPhotos((arr) => arr.filter((x) => x.url !== p.url))} aria-label="Remove photo">
                <X className="size-3" />
              </button>
            </div>
          ))}
          {photos.length < maxPhotos && (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex size-20 flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-border-strong text-xs text-muted">
              <Camera className="size-5" /> Add
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT_IMAGES} capture="environment" multiple className="hidden" onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="xl" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Send />} Submit update
      </Button>
    </form>
  );
}
