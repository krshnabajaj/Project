import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/auth/session";
import { orderScope } from "@/server/services/access";
import { serveObject } from "@/server/files";
import { jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const img = await prisma.orderImage.findFirst({ where: { id, order: orderScope(user) }, include: { order: { select: { orderNumber: true } } } });
    if (!img) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const name = `${img.order.orderNumber ?? "order"}-${img.fileName}`;
    return await serveObject(img.storageKey, name, img.mimeType, req.nextUrl.searchParams.get("download") === "1");
  } catch (err) {
    return jsonError(err, "serve image");
  }
}
