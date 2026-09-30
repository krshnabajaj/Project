"use client";

import * as React from "react";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Alert } from "./misc";
import { Field } from "./form";
import { toast } from "./toaster";
import { initialActionState, type ActionState } from "@/lib/action-state";

export type FormAction = (state: ActionState, fd: FormData) => Promise<ActionState>;

export const FormStateContext = React.createContext<ActionState>(initialActionState);

export function useFieldError(name: string) {
  return React.useContext(FormStateContext).fieldErrors?.[name];
}

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingText ?? "Saving…" : children}
    </Button>
  );
}

/**
 * Form bound to a server action. Shows the returned error/success message and
 * exposes field errors to <Field> children via context.
 */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
  showSuccess = true,
  confirm,
  renderState,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  onSuccess?: (s: ActionState) => void;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  confirm?: string;
  renderState?: (s: ActionState) => React.ReactNode;
}) {
  // Toast from the action wrapper (not an effect): the form may unmount in the same
  // render that delivers the result (e.g. a row moving to another section).
  const wrapped = React.useCallback(
    async (prev: ActionState, fd: FormData) => {
      const r = await action(prev, fd);
      if (r.ok && r.message && showSuccess) toast(r.message);
      return r;
    },
    [action, showSuccess],
  );
  const [state, formAction] = useActionState(wrapped, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  const lastTs = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.ts || state.ts === lastTs.current) return;
    lastTs.current = state.ts;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <FormStateContext.Provider value={state}>
      <form
        ref={ref}
        action={formAction}
        className={className}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {children}
        {renderState ? renderState(state) : null}
        {!renderState && state.error && (
          <Alert tone="danger" className="mt-3">
            {state.error}
          </Alert>
        )}
      </form>
    </FormStateContext.Provider>
  );
}

/** Button that calls a no-form server action (e.g. retry, delete) and reports the result. */
export function ActionButton({
  run,
  children,
  confirm,
  ...props
}: Omit<ButtonProps, "onClick"> & { run: () => Promise<ActionState | void>; confirm?: string }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<ActionState | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await run();
            setResult(r ?? null);
            if (r?.ok && r.message) toast(r.message);
          });
        }}
        {...props}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </Button>
      {result?.error && <span className="text-xs text-[var(--tone-danger-fg)]">{result.error}</span>}
      {result?.ok && result.message && <span className="text-xs text-[var(--tone-success-fg)]">{result.message}</span>}
    </span>
  );
}

/** <Field> that picks up its error from the surrounding ActionForm's state. */
export function FormField(props: Omit<React.ComponentProps<typeof Field>, "error"> & { name: string }) {
  const { name, ...rest } = props;
  const err = useFieldError(name);
  return <Field htmlFor={name} error={err} {...rest} />;
}
