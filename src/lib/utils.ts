import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Business timezone for "today", daily updates and display. */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || process.env.APP_TIMEZONE || "Asia/Kolkata";

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function todayIso(now: Date = new Date(), tz: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Convert YYYY-MM-DD to a Date at UTC midnight (how Postgres DATE columns round-trip). */
export function dateOnly(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function toIsoDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = dateOnly(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Format a DATE column (stored as UTC midnight). e.g. "30 Sep 2026" */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    typeof d === "string" ? new Date(d) : d,
  );
}

/** Format a timestamp in the business timezone. e.g. "30 Sep 2026, 18:32" */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIMEZONE,
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function formatTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: APP_TIMEZONE }).format(
    typeof d === "string" ? new Date(d) : d,
  );
}

export function formatRelative(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(date);
}

export function formatMoney(value: unknown, currency?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency ?? ""} ${n.toFixed(2)}`.trim();
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
