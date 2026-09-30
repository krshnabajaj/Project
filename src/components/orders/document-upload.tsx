"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";

export function DocumentUpload({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-2 border-t border-border pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const form = e.currentTarget;
        const fd = new FormData(form);
        if (!(fd.get("file") as File)?.size) return setError("Choose a file.");
        setBusy(true);
        const res = await fetch(`/api/orders/${orderId}/documents`, { method: "POST", body: fd });
        setBusy(false);
        if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Upload failed");
        form.reset();
        router.refresh();
      }}
    >
      <input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-border-strong file:bg-surface file:px-2 file:py-1 file:text-xs" aria-label="Document file" />
      <div className="flex gap-2">
        <Select name="kind" className="h-8 text-xs" defaultValue="OTHER" aria-label="Document type">
          <option value="OTHER">Other document</option>
          <option value="PO_ATTACHMENT">Original PO</option>
        </Select>
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
