import { NextResponse } from "next/server";
import { authorize } from "@/server/auth/session";
import { uploadDocument } from "@/server/services/purchase-orders";
import { assertSameOrigin, jsonError } from "@/server/http";
import { readUploads } from "@/server/files";

export const dynamic = "force-dynamic";

/** Admin attaches a document (multipart "file", "kind" = PO_ATTACHMENT | OTHER). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await authorize("ADMIN");
    const { id } = await params;
    const form = await req.formData();
    const [file] = await readUploads(form, "file");
    if (!file) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    const kind = form.get("kind") === "PO_ATTACHMENT" ? "PO_ATTACHMENT" : "OTHER";
    const doc = await uploadDocument(id, file, kind, user);
    return NextResponse.json({ ok: true, id: doc.id });
  } catch (err) {
    return jsonError(err, "upload document");
  }
}
