import { NextResponse } from "next/server";
import { authorize } from "@/server/auth/session";
import { uploadMachinePhotos } from "@/server/services/images";
import { assertRateLimit, assertSameOrigin, jsonError } from "@/server/http";
import { readUploads } from "@/server/files";

export const dynamic = "force-dynamic";

/** Engineer uploads machine photographs (multipart field "photos"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await authorize("ENGINEER");
    assertRateLimit(`upload:${user.id}`, 30, 10 * 60_000);
    const { id } = await params;
    const files = await readUploads(await req.formData(), "photos");
    const created = await uploadMachinePhotos(id, files, user);
    return NextResponse.json({ ok: true, uploaded: created.length });
  } catch (err) {
    return jsonError(err, "upload photos");
  }
}
