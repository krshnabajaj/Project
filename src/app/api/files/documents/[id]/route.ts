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
    const doc = await prisma.document.findFirst({ where: { id, order: orderScope(user) } });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Only PDFs and images are rendered inline; everything else downloads.
    const inlineOk = doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/");
    return await serveObject(doc.storageKey, doc.fileName, doc.mimeType, req.nextUrl.searchParams.get("download") === "1" || !inlineOk);
  } catch (err) {
    return jsonError(err, "serve document");
  }
}
