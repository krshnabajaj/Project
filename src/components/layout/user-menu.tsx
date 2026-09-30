"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, KeyRound } from "lucide-react";
import { initials } from "@/lib/utils";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-surface-2" aria-expanded={open} aria-label="Account menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(name)}</span>
        <span className="hidden text-sm font-medium md:block">{name}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted">{email}</div>
          </div>
          <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2" onClick={() => setOpen(false)}>
            <KeyRound className="size-4" /> Change password
          </Link>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
