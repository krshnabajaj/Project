import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { globalSearch } from "@/server/services/queries";
import { statusLabel } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const rows = await globalSearch(q, user, 8);
  return NextResponse.json({
    results: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      poNumber: o.poNumber,
      customer: o.customer?.name ?? null,
      machine: o.machineName,
      engineer: o.engineer?.name ?? null,
      status: statusLabel(o.status),
    })),
  });
}
