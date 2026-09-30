import { redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/dashboard" : "/my-orders");
  const company = await getSetting("company");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Factory className="size-5" aria-hidden />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-subtle">{company.name}</div>
            <h1 className="text-lg font-semibold">Machine Order Tracker</h1>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-subtle">Access is restricted to authorised staff. Contact your administrator for an account.</p>
      </div>
    </main>
  );
}
