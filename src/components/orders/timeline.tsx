import { AlertTriangle, Package, ArrowRight, Calendar } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui/misc";

export interface TimelineUpdate {
  id: string;
  updateDate: Date;
  createdAt: Date;
  engineer: { name: string };
  stage: { name: string };
  progress: number;
  workCompleted: string;
  issues: string | null;
  expectedDelayDays: number | null;
  materialRequired: string | null;
  nextStep: string | null;
  expectedCompletion: Date | null;
  images: { id: string; fileName: string }[];
}

/** Daily update history — newest first, never edited. */
export function DailyTimeline({ updates }: { updates: TimelineUpdate[] }) {
  if (!updates.length) return <EmptyState title="No progress updates yet.">The engineer posts an update at the end of each working day.</EmptyState>;
  return (
    <ol className="relative space-y-5 border-l border-border pl-5">
      {updates.map((u) => (
        <li key={u.id} className="relative">
          <span className="absolute -left-[26px] top-1 size-3 rounded-full border-2 border-surface bg-primary" aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold">{formatDate(u.updateDate)}</span>
            <span className="text-muted">— {u.engineer.name}</span>
            <span className="text-xs text-subtle">posted {formatDateTime(u.createdAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>
              <span className="text-muted">Stage:</span> <span className="font-medium">{u.stage.name}</span>
            </span>
            <span>
              <span className="text-muted">Progress:</span> <span className="tabular font-medium">{u.progress}%</span>
            </span>
          </div>
          <blockquote className="mt-2 whitespace-pre-line rounded-md border-l-2 border-primary bg-surface-2 px-3 py-2 text-sm">{u.workCompleted}</blockquote>
          <div className="mt-2 space-y-1 text-sm">
            {u.issues && (
              <div className="flex gap-2 text-[var(--tone-warning-fg)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">Issue:</span> {u.issues}
                  {u.expectedDelayDays ? ` (expected delay ${u.expectedDelayDays} day${u.expectedDelayDays === 1 ? "" : "s"})` : ""}
                </span>
              </div>
            )}
            {u.materialRequired && (
              <div className="flex gap-2 text-muted">
                <Package className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">Material required:</span> {u.materialRequired}
                </span>
              </div>
            )}
            {u.nextStep && (
              <div className="flex gap-2 text-muted">
                <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">Next:</span> {u.nextStep}
                </span>
              </div>
            )}
            {u.expectedCompletion && (
              <div className="flex gap-2 text-muted">
                <Calendar className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">Estimated completion:</span> {formatDate(u.expectedCompletion)}
                </span>
              </div>
            )}
          </div>
          {u.images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {u.images.map((img) => (
                <a key={img.id} href={`/api/files/images/${img.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/images/${img.id}`} alt={img.fileName} className="size-20 rounded border border-border object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AuditList({ entries }: { entries: { id: string; createdAt: Date; summary: string }[] }) {
  if (!entries.length) return <EmptyState title="No history yet." />;
  return (
    <ul className="divide-y divide-border text-sm">
      {entries.map((a) => (
        <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
          <span className="tabular shrink-0 text-xs text-muted sm:w-40 sm:text-sm">{formatDateTime(a.createdAt)}</span>
          <span className="min-w-0 flex-1">{a.summary}</span>
        </li>
      ))}
    </ul>
  );
}
