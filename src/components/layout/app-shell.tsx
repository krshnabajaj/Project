"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Inbox,
  HardHat,
  Building2,
  Truck,
  BarChart3,
  Settings,
  Columns3,
  Bell,
  Menu,
  X,
  ScrollText,
  Wrench,
  Factory,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";
import { NotificationBell, type BellItem } from "./notification-bell";
import { UserMenu } from "./user-menu";
import { Alert } from "@/components/ui/misc";
import { Toaster } from "@/components/ui/toaster";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

export function AppShell({
  user,
  companyName,
  unread,
  recent,
  gmailProblem,
  reviewCount,
  children,
}: {
  user: { name: string; email: string; role: "ADMIN" | "ENGINEER" };
  companyName: string;
  unread: number;
  recent: BellItem[];
  gmailProblem: string | null;
  reviewCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [pathname]);

  const nav: NavItem[] =
    user.role === "ADMIN"
      ? [
          { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { href: "/orders", label: "Orders", icon: ClipboardList },
          { href: "/board", label: "Production Board", icon: Columns3 },
          { href: "/purchase-orders", label: "Purchase Orders", icon: Inbox, badge: reviewCount },
          { href: "/engineers", label: "Engineers", icon: HardHat },
          { href: "/customers", label: "Customers", icon: Building2 },
          { href: "/dispatch", label: "Dispatch", icon: Truck },
          { href: "/reports", label: "Reports", icon: BarChart3 },
          { href: "/audit", label: "Audit Trail", icon: ShieldCheck },
          { href: "/system-logs", label: "System Logs", icon: ScrollText },
          { href: "/settings", label: "Settings", icon: Settings },
        ]
      : [
          { href: "/my-orders", label: "My Orders", icon: Wrench },
          { href: "/my-orders/completed", label: "Completed", icon: ClipboardList },
          { href: "/notifications", label: "Notifications", icon: Bell, badge: unread },
        ];

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/5 px-4">
        <div className="flex size-8 items-center justify-center rounded bg-white/10 text-white">
          <Factory className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{companyName}</div>
          <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/70">Order Tracker</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== "/my-orders" && pathname.startsWith(`${item.href}/`)) || (item.href === "/orders" && pathname.startsWith("/orders"));
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-active font-medium text-white" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && <span className="rounded-full bg-white/15 px-1.5 text-[11px] font-semibold text-white">{item.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/5 px-4 py-3 text-[11px] text-sidebar-foreground/60">Signed in as {user.role === "ADMIN" ? "Admin" : "Engineer"}</div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</div>
          <button className="absolute left-64 top-3 ml-2 rounded bg-surface p-2" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
          <button className="rounded p-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <GlobalSearch placeholder={user.role === "ADMIN" ? "Search order, PO, customer, machine, engineer…" : "Search my orders…"} />
          </div>
          <NotificationBell unread={unread} items={recent} />
          <UserMenu name={user.name} email={user.email} />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {gmailProblem && (
            <Alert tone="danger" className="mb-4" title={gmailProblem}>
              <Link href="/settings?tab=gmail">Open Gmail settings to reconnect</Link>
            </Alert>
          )}
          {children}
        </main>
        <Toaster />
      </div>
    </div>
  );
}
