"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button, type ButtonProps } from "./button";

const DialogCtx = React.createContext<{ close: () => void }>({ close: () => {} });
export const useDialog = () => React.useContext(DialogCtx);

/** Accessible modal built on the native <dialog> element. */
export function Dialog({
  trigger,
  title,
  description,
  children,
  triggerProps,
  wide,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  triggerProps?: ButtonProps;
  wide?: boolean;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => {
    ref.current?.close();
    setOpen(false);
  }, []);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        {...triggerProps}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
      >
        {trigger}
      </Button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button type="button" onClick={close} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{open && <DialogCtx.Provider value={{ close }}>{children}</DialogCtx.Provider>}</div>
      </dialog>
    </>
  );
}
