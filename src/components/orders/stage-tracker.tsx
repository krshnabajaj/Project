import { Check } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";

export interface TrackerItem {
  id: string;
  name: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  startedAt: Date | null;
  completedAt: Date | null;
  current: boolean;
}

/** Visual assembly progress: ● Material → ● Mechanical → … → ● Completed */
export function StageTracker({ items, compact }: { items: TrackerItem[]; compact?: boolean }) {
  return (
    <ol className={cn("flex gap-0", compact ? "flex-row" : "flex-col md:flex-row")} aria-label="Assembly stages">
      {items.map((s, i) => {
        const done = s.status === "COMPLETED";
        const active = !done && (s.current || s.status === "IN_PROGRESS");
        const last = i === items.length - 1;
        return (
          <li
            key={s.id}
            className={cn("relative flex md:flex-1 md:flex-col md:items-center", compact ? "flex-1 flex-col items-center" : "min-h-12 gap-3 md:gap-0")}
          >
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute",
                  compact ? "left-1/2 top-2.5 h-0.5 w-full" : "left-[11px] top-6 h-[calc(100%-12px)] w-0.5 md:left-1/2 md:top-3 md:h-0.5 md:w-full",
                  done ? "bg-primary" : "bg-border-strong",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex shrink-0 items-center justify-center rounded-full border-2",
                compact ? "size-5" : "size-6",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-accent bg-surface ring-4 ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]",
                !done && !active && "border-border-strong bg-surface",
              )}
              title={`${s.name}: ${done ? "completed" : active ? "in progress" : "pending"}`}
            >
              {done ? <Check className={compact ? "size-3" : "size-3.5"} strokeWidth={3} /> : active ? <span className="size-2 rounded-full bg-accent" /> : null}
            </span>
            {!compact && (
              <div className="pb-4 md:mt-2 md:px-1 md:pb-0 md:text-center">
                <div className={cn("text-xs font-medium leading-tight", done ? "text-foreground" : active ? "text-accent" : "text-subtle")}>{s.name}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-subtle">
                  {done && s.completedAt ? `Done ${formatDateTime(s.completedAt)}` : active && s.startedAt ? `Started ${formatDateTime(s.startedAt)}` : active ? "Current" : ""}
                </div>
              </div>
            )}
            <span className="sr-only">{done ? "completed" : active ? "in progress" : "pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}
