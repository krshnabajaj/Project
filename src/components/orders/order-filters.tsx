"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Download, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { ORDER_STATUSES, STATUS_META } from "@/lib/status";

export function OrderFilters({
  engineers,
  customers,
  exportable,
}: {
  engineers: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  exportable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const set = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
    start(() => router.replace(`${pathname}?${p.toString()}`));
  };
  const exportHref = (format: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set("format", format);
    if (!p.get("status")) p.set("status", "open");
    return `/api/export/orders?${p.toString()}`;
  };
  const active = ["q", "status", "engineer", "customer", "from", "to", "delayed"].some((k) => sp.get(k));

  return (
    <div className={`flex flex-wrap items-end gap-2 ${pending ? "opacity-70" : ""}`}>
      <div className="w-full sm:w-56">
        <Input
          type="search"
          placeholder="Search order, PO, customer…"
          defaultValue={sp.get("q") ?? ""}
          onKeyDown={(e) => e.key === "Enter" && set("q", (e.target as HTMLInputElement).value)}
          onBlur={(e) => e.target.value !== (sp.get("q") ?? "") && set("q", e.target.value)}
          aria-label="Search orders"
        />
      </div>
      <Select className="w-auto" value={sp.get("status") ?? "open"} onChange={(e) => set("status", e.target.value)} aria-label="Status">
        <optgroup label="Groups">
          <option value="open">All open (until dispatched)</option>
          <option value="review">PO review</option>
          <option value="production">In production</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
          <option value="all">All orders</option>
        </optgroup>
        <optgroup label="Status">
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </optgroup>
      </Select>
      <Select className="w-auto" value={sp.get("engineer") ?? ""} onChange={(e) => set("engineer", e.target.value)} aria-label="Engineer">
        <option value="">All engineers</option>
        <option value="none">Unassigned</option>
        {engineers.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
      <Select className="w-auto max-w-48" value={sp.get("customer") ?? ""} onChange={(e) => set("customer", e.target.value)} aria-label="Customer">
        <option value="">All customers</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-xs text-muted">
        PO from
        <Input type="date" className="w-auto" value={sp.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        to
        <Input type="date" className="w-auto" value={sp.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} />
      </label>
      <label className="flex h-9 items-center gap-2 rounded-md border border-border-strong px-3 text-sm">
        <input type="checkbox" checked={sp.get("delayed") === "1"} onChange={(e) => set("delayed", e.target.checked ? "1" : "")} className="accent-[var(--primary)]" />
        Delayed only
      </label>
      {active && (
        <Button variant="ghost" onClick={() => start(() => router.replace(pathname))}>
          <X /> Clear
        </Button>
      )}
      {exportable && (
        <div className="ml-auto flex gap-2">
          <a className={buttonVariants({ variant: "secondary" })} href={exportHref("csv")}>
            <Download /> CSV
          </a>
          <a className={buttonVariants({ variant: "secondary" })} href={exportHref("xlsx")}>
            <Download /> Excel
          </a>
        </div>
      )}
    </div>
  );
}
