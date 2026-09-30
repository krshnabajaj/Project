"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Loader2, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { deletePhotoAction } from "@/server/actions/orders";
import { ACCEPT_IMAGES, compressImage, validImage } from "./image-utils";

interface Existing {
  id: string;
  fileName: string;
}

/**
 * Machine photo manager for the engineer: take/choose photos, preview, remove
 * before upload, upload, and delete/replace uploaded ones until submission.
 */
export function PhotoUploader({
  orderId,
  existing,
  max,
  maxMb,
  locked,
}: {
  orderId: string;
  existing: Existing[];
  max: number;
  maxMb: number;
  locked: boolean;
}) {
  const router = useRouter();
  const [staged, setStaged] = React.useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const pickRef = React.useRef<HTMLInputElement>(null);
  const remaining = max - existing.length - staged.length;

  React.useEffect(() => () => staged.forEach((s) => URL.revokeObjectURL(s.url)), [staged]);

  const add = async (files: FileList | null) => {
    setError(null);
    setMessage(null);
    if (!files?.length) return;
    const list = Array.from(files);
    const bad = list.filter((f) => !validImage(f));
    if (bad.length) setError(`Only JPG, JPEG and PNG images are allowed (${bad.map((b) => b.name).join(", ")}).`);
    const ok = list.filter(validImage);
    if (ok.length > remaining) setError(`Maximum ${max} photographs per order — you can add ${Math.max(0, remaining)} more.`);
    const take = ok.slice(0, Math.max(0, remaining));
    const compressed = await Promise.all(take.map((f) => compressImage(f)));
    const tooBig = compressed.filter((f) => f.size > maxMb * 1048576);
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")} exceed${tooBig.length === 1 ? "s" : ""} the ${maxMb} MB limit.`);
    const good = compressed.filter((f) => f.size <= maxMb * 1048576);
    setStaged((s) => [...s, ...good.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const upload = async () => {
    if (!staged.length) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    staged.forEach((s) => fd.append("photos", s.file, s.file.name));
    try {
      const res = await fetch(`/api/orders/${orderId}/photos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setStaged([]);
      setMessage(`${data.uploaded} photograph${data.uploaded === 1 ? "" : "s"} uploaded.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this photograph?")) return;
    setDeleting(id);
    const r = await deletePhotoAction(id, orderId);
    setDeleting(null);
    if (!r.ok) setError(r.error ?? "Could not delete");
    else router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          Machine photographs <span className="tabular text-muted">({existing.length}/{max})</span>
        </span>
        {!locked && remaining > 0 && <span className="text-xs text-muted">{remaining} more allowed</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {existing.map((img) => (
          <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md border border-border bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/images/${img.id}`} alt={img.fileName} className="size-full object-cover" loading="lazy" />
            {!locked && (
              <button
                type="button"
                onClick={() => remove(img.id)}
                disabled={deleting === img.id}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white"
                aria-label={`Delete ${img.fileName}`}
              >
                {deleting === img.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            )}
          </div>
        ))}
        {staged.map((s, i) => (
          <div key={s.url} className="relative aspect-square overflow-hidden rounded-md border-2 border-dashed border-accent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt={`Preview ${i + 1}`} className="size-full object-cover opacity-90" />
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">not uploaded</span>
            <button
              type="button"
              onClick={() => setStaged((arr) => arr.filter((x) => x.url !== s.url))}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white"
              aria-label="Remove preview"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      {!locked && (
        <>
          <input ref={cameraRef} type="file" accept={ACCEPT_IMAGES} capture="environment" className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          <input ref={pickRef} type="file" accept={ACCEPT_IMAGES} multiple className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={() => cameraRef.current?.click()} disabled={remaining <= 0 || busy}>
              <Camera /> Take photo
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => pickRef.current?.click()} disabled={remaining <= 0 || busy}>
              <ImagePlus /> Choose photos
            </Button>
          </div>
          {staged.length > 0 && (
            <Button type="button" size="lg" className="w-full" onClick={upload} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload {staged.length} photo{staged.length === 1 ? "" : "s"}
            </Button>
          )}
        </>
      )}
      {locked && <p className="text-xs text-muted">Photographs were submitted and can no longer be changed.</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
    </div>
  );
}
