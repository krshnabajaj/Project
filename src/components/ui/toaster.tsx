"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Toast = { id: number; message: string; tone: "success" | "danger" };

/** Fire a toast from anywhere on the client. Survives the component that fired it unmounting. */
export function toast(message: string, tone: Toast["tone"] = "success") {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, tone } }));
}

export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    const on = (e: Event) => {
      const { message, tone } = (e as CustomEvent<{ message: string; tone: Toast["tone"] }>).detail;
      const id = Date.now() + Math.random();
      setItems((t) => [...t, { id, message, tone }]);
      setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener("app:toast", on);
    return () => window.removeEventListener("app:toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm shadow-lg">
          {t.tone === "success" ? <CheckCircle2 className="size-4 text-[var(--tone-success-fg)]" /> : <XCircle className="size-4 text-[var(--tone-danger-fg)]" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
