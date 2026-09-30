import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { findOrderForActor } from "@/server/services/access";
import { listStages } from "@/server/services/stages";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { DailyUpdateForm } from "@/components/orders/daily-update-form";
import { canPerform, MAX_PROGRESS_PHOTOS_PER_UPDATE } from "@/lib/workflow";
import { statusLabel } from "@/lib/status";
import { todayIso } from "@/lib/utils";
import { AppError } from "@/lib/errors";

export const metadata = { title: "Update progress" };

export default async function UpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ENGINEER");
  const { id } = await params;
  const order = await findOrderForActor(id, user, { customer: true, currentStage: true }).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const stages = (await listStages()).filter((s) => s.phase !== "FINAL");
  const allowed = canPerform("PROGRESS_UPDATE", "ENGINEER", order.status);

  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/orders/${order.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeft className="size-4" /> {order.orderNumber}
      </Link>
      <h1 className="text-xl font-semibold">Daily progress update</h1>
      <p className="mb-4 text-sm text-muted">
        {order.customer?.name} · {order.machineName} · currently {order.currentStage?.name ?? "not started"} ({order.progressPercentage}%)
      </p>
      {!allowed ? (
        <Alert tone="warning">
          {order.status === "ASSIGNED" ? "Accept the order first, then post progress updates." : `Progress cannot be updated while the order is "${statusLabel(order.status)}".`}
        </Alert>
      ) : (
        <Card>
          <CardContent>
            <DailyUpdateForm
              orderId={order.id}
              stages={stages.map((s) => ({ id: s.id, name: s.name, defaultProgress: s.defaultProgress }))}
              currentStageId={order.currentStageId && stages.some((s) => s.id === order.currentStageId) ? order.currentStageId : null}
              currentProgress={order.progressPercentage}
              today={todayIso()}
              maxPhotos={MAX_PROGRESS_PHOTOS_PER_UPDATE}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
