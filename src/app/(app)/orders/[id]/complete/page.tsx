import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { findOrderForActor } from "@/server/services/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Textarea, Label } from "@/components/ui/form";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { PhotoUploader } from "@/components/orders/photo-uploader";
import { canPerform, MAX_MACHINE_PHOTOS } from "@/lib/workflow";
import { maxUploadBytes } from "@/lib/env";
import { completeAndSubmitAction, markCompletedAction, submitPhotosAction } from "@/server/actions/orders";
import { AppError } from "@/lib/errors";

export const metadata = { title: "Complete machine" };

export default async function CompletePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ENGINEER");
  const { id } = await params;
  const order = await findOrderForActor(id, user, { customer: true, images: { where: { kind: "MACHINE" }, orderBy: { createdAt: "asc" } } }).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const photos = order.images;
  const canUpload = canPerform("UPLOAD_PHOTO", "ENGINEER", order.status) && !order.photosSubmittedAt;
  const canComplete = canPerform("MARK_COMPLETED", "ENGINEER", order.status);
  const canSubmit = canPerform("SUBMIT_PHOTOS", "ENGINEER", order.status);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <Link href={`/orders/${order.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ChevronLeft className="size-4" /> {order.orderNumber}
        </Link>
        <h1 className="text-xl font-semibold">Machine completion</h1>
        <p className="text-sm text-muted">
          {order.customer?.name} · {order.machineName}
        </p>
      </div>

      {order.photosSubmittedAt ? (
        <Alert tone="success" title="Completion submitted">
          {photos.length} photographs submitted. The completion summary was sent to the admin.
        </Alert>
      ) : (
        <Alert tone="info">
          1. Take up to {MAX_MACHINE_PHOTOS} photographs of the finished machine. 2. Mark the machine completed. The admin receives a WhatsApp alert and an email summary with the photos.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Photographs</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoUploader orderId={order.id} existing={photos.map((p) => ({ id: p.id, fileName: p.fileName }))} max={MAX_MACHINE_PHOTOS} maxMb={Math.round(maxUploadBytes() / 1048576)} locked={!canUpload} />
        </CardContent>
      </Card>

      {(canComplete || canSubmit) && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2 — {canComplete ? "Mark machine completed" : "Submit photographs"}</CardTitle>
          </CardHeader>
          <CardContent>
            {canComplete ? (
              <ActionForm action={(photos.length ? completeAndSubmitAction : markCompletedAction).bind(null, order.id)} className="space-y-3" confirm={photos.length ? `Mark the machine completed and submit ${photos.length} photograph(s)? Photos cannot be changed afterwards.` : "Mark the machine completed? You can upload photographs next."}>
                <div>
                  <Label htmlFor="remarks">Final remarks (optional)</Label>
                  <Textarea id="remarks" name="remarks" rows={3} className="text-base" placeholder="e.g. Final testing completed; machine ready for packing." maxLength={2000} />
                </div>
                <SubmitButton size="xl" variant="success" className="w-full">
                  <CheckCircle2 /> {photos.length ? `Mark completed & submit ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "Mark machine completed"}
                </SubmitButton>
                {!photos.length && <p className="text-xs text-muted">Tip: upload photos first to finish in one step.</p>}
              </ActionForm>
            ) : (
              <ActionForm action={submitPhotosAction.bind(null, order.id)} confirm={`Submit ${photos.length} photograph(s) and send the completion summary? Photos cannot be changed afterwards.`}>
                <SubmitButton size="xl" className="w-full" disabled={!photos.length}>
                  <CheckCircle2 /> Submit {photos.length} photo{photos.length === 1 ? "" : "s"} & send summary
                </SubmitButton>
                {!photos.length && <p className="mt-2 text-xs text-muted">Upload at least one photograph first.</p>}
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
