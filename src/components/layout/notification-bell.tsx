"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markNotificationsReadAction } from "@/server/actions/admin";
import { formatRelative } from "@/lib/utils";

export type BellItem = { id: string; title: string; message: string; link: string | null; read: boolean; createdAt: string };

export function NotificationBell({ unread, items }: { unread: number; items: BellItem[] }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 hover:bg-surface-2" aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-[var(--tone-danger-fg)] px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-accent hover:underline" onClick={() => markNotificationsReadAction("all")}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No notifications yet.</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-border last:border-0 ${n.read ? "" : "bg-[var(--tone-info-bg)]/40"}`}>
                <Link
                  href={n.link ?? "/notifications"}
                  onClick={() => {
                    setOpen(false);
                    if (!n.read) void markNotificationsReadAction([n.id]);
                  }}
                  className="block px-3 py-2.5 hover:bg-surface-2"
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{n.title}</div>
                      <div className="line-clamp-2 text-xs text-muted">{n.message}</div>
                      <div className="mt-0.5 text-[11px] text-subtle">{formatRelative(n.createdAt)}</div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2 text-center text-xs text-accent hover:bg-surface-2">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
