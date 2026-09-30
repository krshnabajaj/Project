import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, FileText, Mail } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert, DefinitionList } from "@/components/ui/misc";
import { OrderForm } from "@/components/orders/order-form";
import { orderFormValues } from "@/components/orders/form-values";
import { ReasonDialog, StepButton } from "@/components/orders/order-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { approveOrderAction, cancelOrderAction, resolveDuplicateAction, updateOrderAction } from "@/server/actions/orders";
import { missingForApproval } from "@/server/services/orders";
import type { PoFields } from "@/server/integrations/extraction/fields";
import { formatDateTime, formatDate } from "@/lib/utils";

export const metadata = { title: "Review PO" };

export default async function ReviewPoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      purchaseOrders: { orderBy: { createdAt: "asc" }, include: { duplicateOf: { select: { id: true, orderNumber: true, poNumber: true, status: true, customer: { select: { name: true } } } } } },
      documents: true,
    },
  });
  if (!order) notFound();
  if (order.status !== "PO_RECEIVED" && order.status !== "PO_UNDER_REVIEW") redirect(`/orders/${id}`);
  const po = order.purchaseOrders[0];
  const extracted = (po?.extractedData ?? {}) as { fields?: Partial<PoFields>; attachments?: { filename: string; kind: string; warning?: string }[]; customerMatch?: { name: string; how: string } | null };
  const f = extracted.fields ?? {};
  const customers = await prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const values = {
    ...orderFormValues(order),
    newCustomer: order.customerId
      ? undefined
      : {
          name: f.customerName?.value,
          billingAddress: f.billingAddress?.value,
          shippingAddress: f.shippingAddress?.value,
          contactPerson: f.contactPerson?.value,
          email: f.email?.value,
          phone: f.phone?.value,
        },
  };
  const confidence = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v ? { confidence: v.confidence, source: v.source } : undefined]));
  const missing = missingForApproval(order);
  const suspected = po?.duplicateStatus === "SUSPECTED";

  return (
    <div className="space-y-5">
      <div>
        <Link href="/purchase-orders" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ChevronLeft className="size-4" /> Purchase Orders
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Review PO {order.poNumber ?? ""}</h1>
            <StatusBadge status={order.status} />
            {po && <Badge tone={po.extractionStatus === "SUCCESS" ? "success" : po.extractionStatus === "FAILED" ? "danger" : "warning"}>Extraction: {po.extractionStatus}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <ReasonDialog action={cancelOrderAction.bind(null, id)} trigger="Reject PO" title="Reject this PO" submit="Reject" variant="danger" placeholder="e.g. Not a purchase order / spam" />
            <StepButton action={approveOrderAction.bind(null, id)} size="lg" confirm="Approve this PO and create a production order?">
              Approve & create order
            </StepButton>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">PO requires review before it becomes an active production order. Correct the extracted data, then approve.</p>
      </div>

      {suspected && po && (
        <Alert tone="danger" title="Possible duplicate PO detected.">
          <ul className="mb-3 list-disc pl-4">
            {po.duplicateReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {po.duplicateOf && (
            <p className="mb-3">
              Most likely duplicate of{" "}
              <Link href={`/orders/${po.duplicateOf.id}`} target="_blank">
                {po.duplicateOf.orderNumber ?? "a draft PO"}
              </Link>{" "}
              ({po.duplicateOf.customer?.name ?? "—"}, PO {po.duplicateOf.poNumber ?? "—"}).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {po.duplicateOf && (
              <ActionForm action={resolveDuplicateAction.bind(null, id)} confirm="Merge this PO email and its documents into the existing order? This draft will be closed.">
                <input type="hidden" name="resolution" value="MERGE" />
                <SubmitButton size="sm">Merge into existing</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={resolveDuplicateAction.bind(null, id)} confirm="Ignore this PO as a duplicate? The draft will be cancelled.">
              <input type="hidden" name="resolution" value="IGNORE" />
              <SubmitButton size="sm" variant="secondary">
                Ignore
              </SubmitButton>
            </ActionForm>
            <ActionForm action={resolveDuplicateAction.bind(null, id)}>
              <input type="hidden" name="resolution" value="CREATE_ANYWAY" />
              <SubmitButton size="sm" variant="secondary">
                Create anyway
              </SubmitButton>
            </ActionForm>
          </div>
        </Alert>
      )}

      {!!po?.extractionWarnings.length && (
        <Alert tone="warning" title="Review these items">
          <ul className="list-disc pl-4">
            {po.extractionWarnings.map((w) => (
              <li key={w}>⚠️ {w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {missing.length > 0 && <Alert tone="info">Required before approval: {missing.join(", ")}.</Alert>}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Order details (editable)</CardTitle>
            <span className="text-xs text-muted">Badges show automatically extracted values and their confidence</span>
          </CardHeader>
          <CardContent>
            <OrderForm action={updateOrderAction.bind(null, id)} customers={customers} values={values} confidence={confidence} submitLabel="Save corrections" />
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-4" /> Source email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList
                className="sm:grid-cols-1"
                items={[
                  ["From", po?.sender ?? (po?.source === "MANUAL" ? "Manual entry" : "—")],
                  ["Subject", po?.subject],
                  ["Received", formatDateTime(po?.receivedAt ?? order.createdAt)],
                  ["Gmail message ID", po?.gmailMessageId ? <span className="font-mono text-xs">{po.gmailMessageId}</span> : null],
                  ["Customer match", extracted.customerMatch ? `${extracted.customerMatch.name} (by ${extracted.customerMatch.how})` : "No existing customer matched"],
                ]}
              />
              {po?.bodyText && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-accent">Show email text</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-3 text-xs">{po.bodyText}</pre>
                </details>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PO attachments</CardTitle>
            </CardHeader>
            <CardContent>
              {order.documents.length === 0 ? (
                <p className="text-sm text-muted">No attachment stored.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {order.documents.map((d) => (
                    <li key={d.id}>
                      <a href={`/api/files/documents/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-accent hover:underline">
                        <FileText className="size-4" /> {d.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {extracted.attachments?.some((a) => a.warning) && (
                <ul className="mt-3 space-y-1 text-xs text-[var(--tone-warning-fg)]">
                  {extracted.attachments.filter((a) => a.warning).map((a) => (
                    <li key={a.filename}>{a.warning}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Extracted values</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(f).length === 0 ? (
                <p className="text-sm text-muted">Nothing could be extracted automatically.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {Object.entries(f).map(([k, v]) =>
                    v ? (
                      <li key={k}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{k}</span>
                          <Badge tone={v.confidence === "high" ? "success" : v.confidence === "medium" ? "info" : "warning"}>{v.confidence}</Badge>
                        </div>
                        <div className="text-foreground">{k.toLowerCase().includes("date") ? formatDate(String(v.value)) : String(v.value)}</div>
                        <div className="truncate text-subtle" title={v.source}>
                          from: {v.source}
                        </div>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
