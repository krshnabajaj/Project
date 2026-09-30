import * as React from "react";
import { cn } from "@/lib/utils";
import { STATUS_META, type OrderStatusValue, type Tone } from "@/lib/status";

const toneClass: Record<Tone, string> = {
  neutral: "bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]",
  info: "bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]",
  progress: "bg-[var(--tone-progress-bg)] text-[var(--tone-progress-fg)]",
  warning: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]",
  success: "bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]",
  danger: "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]",
  muted: "bg-[var(--tone-muted-bg)] text-[var(--tone-muted-fg)]",
  accent: "bg-[var(--tone-accent-bg)] text-[var(--tone-accent-fg)]",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", toneClass[tone], className)}
      {...props}
    />
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status as OrderStatusValue];
  return (
    <Badge tone={meta?.tone ?? "neutral"} className={className} title={meta?.description}>
      {meta?.label ?? status}
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge tone="danger" title="Expected completion date has passed">
      <span aria-hidden>●</span> Overdue
    </Badge>
  );
}
