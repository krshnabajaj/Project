import JSZip from "jszip";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/auth/session";
import { orderScope } from "@/server/services/access";
import { storage } from "@/server/integrations/storage";
import { contentDisposition, jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

/** Download all machine photographs of an order as a ZIP. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const order = await prisma.order.findFirst({ where: { id, ...orderScope(user) }, include: { images: { where: { kind: "MACHINE" }, orderBy: { createdAt: "asc" } } } });
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!order.images.length) return NextResponse.json({ error: "No photographs uploaded" }, { status: 404 });
    const zip = new JSZip();
    const prefix = order.orderNumber ?? "order";
    for (const [i, img] of order.images.entries()) {
      const obj = await storage().get(img.storageKey);
      zip.file(`${prefix}-photo-${String(i + 1).padStart(2, "0")}.jpg`, obj.body);
    }
    const buf = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    return new NextResponse(buf as unknown as BodyInit, {
      headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition("attachment", `${prefix}-photos.zip`), "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return jsonError(err, "photos zip");
  }
}
