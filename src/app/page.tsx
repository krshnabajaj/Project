import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(user.role === "ADMIN" ? "/dashboard" : "/my-orders");
}
