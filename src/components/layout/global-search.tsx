"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type Result = { id: string; orderNumber: string | null; poNumber: string | null; customer: string | null; machine: string | null; engineer: string | null; status: string };

export function GlobalSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults((await res.json()).results);
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* aborted */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (r?: Result) => {
    setOpen(false);
    if (r) router.push(`/orders/${r.id}`);
    else if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") {
            e.preventDefault();
            go(open ? results[active] : undefined);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        aria-label="Global search"
        className="h-9 w-full rounded-md border border-border bg-surface-2 pl-9 pr-3 text-sm placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted">No matching orders.</div>
          ) : (
            <ul role="listbox">
              {results.map((r, i) => (
                <li key={r.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(r)}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-surface-2" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{r.orderNumber ?? "Draft PO"}</span>
                      {r.poNumber && <span className="text-muted"> · PO {r.poNumber}</span>}
                      <span className="block truncate text-xs text-muted">
                        {[r.customer, r.machine, r.engineer].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-subtle">{r.status}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go()} className="w-full border-t border-border px-3 py-2 text-left text-xs text-accent">
                  See all results for “{q}”
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
