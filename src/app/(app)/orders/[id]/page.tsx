import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download, FileText, Mail, MessageCircle, Pencil, Camera, ClipboardCheck, AlertTriangle } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getOrderDetail, engineerWorkload } from "@/server/services/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, OverdueBadge, StatusBadge } from "@/components/ui/badge";
import { Alert, DefinitionList, EmptyState, ProgressBar } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { StageTracker } from "@/components/orders/stage-tracker";
import { DailyTimeline, AuditList } from "@/components/orders/timeline";
import { AssignDialog, DispatchDialog, NoteForm, PackDialog, ReasonDialog, RetryButton, StepButton } from "@/components/orders/order-actions";
import { DocumentUpload } from "@/components/orders/document-upload";
import * as A from "@/server/actions/orders";
import { canPerform } from "@/lib/workflow";
import { MAX_MACHINE_PHOTOS } from "@/lib/workflow";
import { isOverdue, statusLabel, type OrderStatusValue } from "@/lib/status";
import { formatDate, formatDateTime, formatMoney, toIsoDate, cn } from "@/lib/utils";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getOrderDetail(id, user);
  if (!detail) notFound();
  const { order, tracker, audits, today } = detail;
  const isAdmin = user.role === "ADMIN";
  const status = order.status as OrderStatusValue;
  if (isAdmin && (status === "PO_RECEIVED" || status === "PO_UNDER_REVIEW")) redirect(`/purchase-orders/${order.id}`);

  const overdue = isOverdue(order.expectedCompletionDate, status, today);
  const latest = order.dailyUpdates[0];
  const openIssue = latest?.issues ? latest : null;
  const photos = order.images;
  const engineers = isAdmin ? (await engineerWorkload()).filter((e) => e.active) : [];
  const can = (a: Parameters<typeof canPerform>[0]) => canPerform(a, user.role, status);
  const po = order.purchaseOrders[0];
  const trackerItems = tracker.map((t) => ({
    id: t.stage.id,
    name: t.stage.name,
    status: t.progress?.status ?? "PENDING",
    startedAt: t.progress?.startedAt ?? null,
    completedAt: t.progress?.completedAt ?? null,
    current: order.currentStageId === t.stage.id,
  }));
  const failedNotifications = isAdmin && order.notifications ? order.notifications.filter((n) => n.status === "FAILED" || n.status === "SKIPPED") : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Link href={isAdmin ? "/orders" : "/my-orders"} className="hover:underline">
              {isAdmin ? "Orders" : "My Orders"}
            </Link>
            <span>/</span>
            <span>{order.orderNumber}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
            <StatusBadge status={status} />
            {overdue && <OverdueBadge />}
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-foreground">{order.customer?.name ?? "—"}</span> · {order.machineName ?? "—"}
            {order.quantity ? ` × ${order.quantity}` : ""} · Engineer: <span className="font-medium text-foreground">{order.engineer?.name ?? "Unassigned"}</span>
          </p>
          <ProgressBar value={order.progressPercentage} className="mt-2 max-w-sm" />
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {/* Engineer actions */}
          {can("ACCEPT") && (
            <StepButton action={A.acceptOrderAction.bind(null, order.id)} size="lg" variant="success">
              Accept order
            </StepButton>
          )}
          {can("PROGRESS_UPDATE") && (
            <Link href={`/orders/${order.id}/update`} className={buttonVariants({ size: "lg" })}>
              <ClipboardCheck /> Update progress
            </Link>
          )}
          {(can("MARK_COMPLETED") || can("SUBMIT_PHOTOS") || (user.role === "ENGINEER" && can("UPLOAD_PHOTO"))) && (
            <Link href={`/orders/${order.id}/complete`} className={buttonVariants({ size: "lg", variant: can("SUBMIT_PHOTOS") ? "primary" : "secondary" })}>
              <Camera /> {can("SUBMIT_PHOTOS") ? "Submit completion photos" : "Photos & completion"}
            </Link>
          )}
          {/* Admin actions */}
          {isAdmin && can("ASSIGN") && <AssignDialog action={A.assignEngineerAction.bind(null, order.id)} engineers={engineers} expected={toIsoDate(order.expectedCompletionDate)} minDate={today} />}
          {isAdmin && can("REASSIGN") && (
            <AssignDialog action={A.assignEngineerAction.bind(null, order.id)} engineers={engineers} currentEngineerId={order.engineerId} expected={toIsoDate(order.expectedCompletionDate)} reassign minDate={today} />
          )}
          {isAdmin && can("MARK_PACKED") && <PackDialog action={A.markPackedAction.bind(null, order.id)} adminName={user.name} />}
          {isAdmin && can("MARK_READY") && (
            <StepButton action={A.markReadyAction.bind(null, order.id)} confirm="Mark this order READY FOR DISPATCH?">
              Mark ready for dispatch
            </StepButton>
          )}
          {isAdmin && can("MARK_DISPATCHED") && <DispatchDialog action={A.markDispatchedAction.bind(null, order.id)} today={today} />}
          {isAdmin && can("CLOSE") && (
            <StepButton action={A.closeOrderAction.bind(null, order.id)} variant="secondary" confirm="Close this order?">
              Close order
            </StepButton>
          )}
          {isAdmin && can("EDIT") && (
            <Link href={`/orders/${order.id}/edit`} className={buttonVariants({ variant: "secondary" })}>
              <Pencil /> Edit
            </Link>
          )}
          {isAdmin && can("RESUME") && <StepButton action={A.resumeOrderAction.bind(null, order.id)}>Resume</StepButton>}
          {isAdmin && can("HOLD") && <ReasonDialog action={A.holdOrderAction.bind(null, order.id)} trigger="Hold" title="Put order on hold" submit="Put on hold" />}
          {isAdmin && can("CANCEL") && <ReasonDialog action={A.cancelOrderAction.bind(null, order.id)} trigger="Cancel" title="Cancel order" submit="Cancel order" variant="danger" />}
        </div>
      </div>

      {sp.created && <Alert tone="success">Order {order.orderNumber} created.</Alert>}
      {sp.updated && <Alert tone="success">Update submitted — the admin has been notified.</Alert>}
      {status === "ON_HOLD" && <Alert tone="warning" title="Order on hold">{order.holdReason}</Alert>}
      {status === "CANCELLED" && <Alert tone="danger" title="Order cancelled">{order.cancelReason}</Alert>}
      {status === "ASSIGNED" && user.role === "ENGINEER" && <Alert tone="info" title="New assignment">Review the PO and machine details below, then accept the order to start work.</Alert>}
      {status === "ACCEPTED" && user.role === "ENGINEER" && (
        <Alert tone="success" title="Order accepted — the admin has been notified">Post a progress update at the end of each working day using “Update progress”.</Alert>
      )}
      {status === "COMPLETED" && isAdmin && <Alert tone="info" title="MACHINE COMPLETED">Waiting for the engineer to submit the completion photographs. Packing becomes available after that.</Alert>}
      {status === "PHOTOS_UPLOADED" && isAdmin && <Alert tone="success" title="MACHINE COMPLETED — photos received">The completion summary was emailed. The machine can now be packed.</Alert>}
      {failedNotifications.length > 0 && (
        <Alert tone="warning" title={`${failedNotifications.length} notification(s) not delivered`}>
          <a href="#notifications">Review and retry below.</a>
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          {/* At a glance */}
          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList
                className="lg:grid-cols-3"
                items={[
                  ["Source", order.source === "GMAIL" ? `Gmail — ${po?.senderEmail ?? po?.sender ?? "email"}` : "Created manually"],
                  ["PO number", order.poNumber],
                  ["Responsible", order.engineer?.name ?? "Unassigned"],
                  ["Current stage", order.currentStage?.name ?? "Not started"],
                  ["Latest update", latest ? `${formatDate(latest.updateDate)} — ${latest.workCompleted}` : "None yet"],
                  ["Open issue", openIssue ? <span className="text-[var(--tone-warning-fg)]">{openIssue.issues}</span> : "None reported"],
                  ["Expected completion", order.expectedCompletionDate ? <span className={cn(overdue && "text-[var(--tone-danger-fg)]")}>{formatDate(order.expectedCompletionDate)}{overdue ? " (overdue)" : ""}</span> : "Not set"],
                  ["Engineer estimate", order.dailyUpdates.find((u) => u.expectedCompletion)?.expectedCompletion ? formatDate(order.dailyUpdates.find((u) => u.expectedCompletion)!.expectedCompletion) : "—"],
                  ["Photographs", `${photos.length}/${MAX_MACHINE_PHOTOS}${order.photosSubmittedAt ? " — submitted" : ""}`],
                  ["Completed", order.completedAt ? formatDateTime(order.completedAt) : "No"],
                  ["Packed", order.dispatch?.packedAt ? formatDateTime(order.dispatch.packedAt) : "No"],
                  ["Ready for dispatch", order.dispatch?.readyAt ? formatDateTime(order.dispatch.readyAt) : "No"],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assembly progress</CardTitle>
              <span className="tabular text-sm text-muted">{order.progressPercentage}%</span>
            </CardHeader>
            <CardContent>
              <StageTracker items={trackerItems} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily updates</CardTitle>
              <span className="text-xs text-muted">{order.dailyUpdates.length} update(s) · history is never overwritten</span>
            </CardHeader>
            <CardContent>
              <DailyTimeline updates={order.dailyUpdates} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Machine photographs ({photos.length}/{MAX_MACHINE_PHOTOS})</CardTitle>
              {photos.length > 0 && (
                <a href={`/api/orders/${order.id}/photos-zip`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <Download /> Download all
                </a>
              )}
            </CardHeader>
            <CardContent>
              {photos.length === 0 ? (
                <EmptyState title="No machine photographs yet.">Up to 8 photographs are uploaded by the engineer on completion.</EmptyState>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((img) => (
                    <figure key={img.id} className="overflow-hidden rounded-md border border-border">
                      <a href={`/api/files/images/${img.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/images/${img.id}`} alt={img.fileName} className="aspect-square w-full object-cover" loading="lazy" />
                      </a>
                      <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] text-muted">
                        <span className="truncate">
                          {img.uploadedBy.name} · {formatDateTime(img.createdAt)}
                        </span>
                        <a href={`/api/files/images/${img.id}?download=1`} aria-label={`Download ${img.fileName}`} className="shrink-0 hover:text-foreground">
                          <Download className="size-3.5" />
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit history</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditList entries={audits} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
              {isAdmin && order.customer && (
                <Link href={`/orders?customer=${order.customer.id}&status=all`} className="text-xs text-accent hover:underline">
                  All orders
                </Link>
              )}
            </CardHeader>
            <CardContent>
              <DefinitionList
                className="sm:grid-cols-1"
                items={[
                  ["Name", order.customer?.name],
                  ["Contact person", order.customer?.contactPerson],
                  ["Email", order.customer?.email],
                  ["Phone", order.customer?.phone],
                  ["Billing address", order.customer?.billingAddress],
                  ["Shipping address", order.customer?.shippingAddress],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Purchase order</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList
                items={[
                  ["PO number", order.poNumber],
                  ["PO date", formatDate(order.poDate)],
                  ["Delivery date", formatDate(order.deliveryDate)],
                  ["Reference", order.referenceNumber],
                  ["Payment terms", order.paymentTerms],
                  ["Received", po?.receivedAt ? formatDateTime(po.receivedAt) : formatDateTime(order.createdAt)],
                  ...(po?.subject ? ([["Email subject", po.subject]] as [string, string][]) : []),
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Machine</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList
                items={[
                  ["Machine / product", order.machineName],
                  ["Model", order.machineModel],
                  ["Quantity", order.quantity],
                  ["Specifications", order.specifications],
                  ["Special instructions", order.specialInstructions],
                ]}
              />
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Commercial</CardTitle>
              </CardHeader>
              <CardContent>
                <DefinitionList
                  items={[
                    ["Unit price", formatMoney(order.unitPrice, order.currency)],
                    ["Tax", formatMoney(order.tax, order.currency)],
                    ["Total value", formatMoney(order.totalValue, order.currency)],
                    ["Currency", order.currency],
                  ]}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.documents.length === 0 ? (
                <p className="text-sm text-muted">No documents attached.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {order.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <a href={`/api/files/documents/${d.id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                        <FileText className="size-4 shrink-0 text-muted" />
                        <span className="truncate">{d.fileName}</span>
                      </a>
                      <span className="flex shrink-0 items-center gap-2">
                        {d.kind === "PO_ATTACHMENT" && <Badge tone="info">PO</Badge>}
                        <a href={`/api/files/documents/${d.id}?download=1`} aria-label={`Download ${d.fileName}`} className="text-muted hover:text-foreground">
                          <Download className="size-4" />
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && <DocumentUpload orderId={order.id} />}
            </CardContent>
          </Card>

          {order.dispatch && (
            <Card>
              <CardHeader>
                <CardTitle>Packing & dispatch</CardTitle>
              </CardHeader>
              <CardContent>
                <DefinitionList
                  items={[
                    ["Packed by", order.dispatch.packedByName ?? order.dispatch.packedBy?.name],
                    ["Packed at", formatDateTime(order.dispatch.packedAt)],
                    ["Packages", order.dispatch.packageCount],
                    ["Dimensions", order.dispatch.packageDimensions],
                    ["Weight (kg)", order.dispatch.weightKg?.toString()],
                    ["Packing remarks", order.dispatch.packingRemarks],
                    ["Ready at", formatDateTime(order.dispatch.readyAt)],
                    ["Dispatched", order.dispatch.dispatchedAt ? formatDate(order.dispatch.dispatchedAt) : null],
                    ["Courier", order.dispatch.courier],
                    ["Transporter", order.dispatch.transporter],
                    ["AWB / LR", order.dispatch.trackingNumber],
                    ["Vehicle", order.dispatch.vehicleNumber],
                    ["Dispatch remarks", order.dispatch.dispatchRemarks],
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <NoteForm action={A.addNoteAction.bind(null, order.id)} />
                <ul className="space-y-3 text-sm">
                  {order.notes.map((n) => (
                    <li key={n.id} className="rounded-md bg-surface-2 px-3 py-2">
                      <div className="whitespace-pre-line">{n.body}</div>
                      <div className="mt-1 text-xs text-muted">
                        {n.author.name} · {formatDateTime(n.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {isAdmin && order.notifications && (
            <Card id="notifications">
              <CardHeader>
                <CardTitle>WhatsApp & email log</CardTitle>
                {order.photosSubmittedAt && (
                  <StepButton action={A.resendCompletionEmailAction.bind(null, order.id)} variant="secondary" size="sm">
                    Resend completion email
                  </StepButton>
                )}
              </CardHeader>
              <CardContent>
                {order.notifications.length === 0 ? (
                  <p className="text-sm text-muted">No notifications sent for this order yet.</p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {order.notifications.map((n) => (
                      <li key={n.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-medium">
                            {n.channel === "WHATSAPP" ? <MessageCircle className="size-4 text-muted" /> : <Mail className="size-4 text-muted" />}
                            {n.type.replaceAll("_", " ").toLowerCase()}
                          </span>
                          <Badge tone={n.status === "SENT" ? "success" : n.status === "FAILED" ? "danger" : n.status === "SKIPPED" ? "warning" : "info"}>{n.status}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          To {n.recipient} · {formatDateTime(n.sentAt ?? n.createdAt)}
                        </div>
                        {n.error && (
                          <div className="mt-1 flex items-start gap-1.5 text-xs text-[var(--tone-danger-fg)]">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {n.error}
                          </div>
                        )}
                        {(n.status === "FAILED" || n.status === "SKIPPED") && (
                          <div className="mt-1.5">
                            <RetryButton run={A.retryNotificationAction.bind(null, n.id, order.id)} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-subtle">
            Status: {statusLabel(status)} · Created {formatDateTime(order.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
