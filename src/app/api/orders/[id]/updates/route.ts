import { NextResponse } from "next/server";
import { authorize } from "@/server/auth/session";
import { addDailyUpdate } from "@/server/services/daily-updates";
import { assertRateLimit, assertSameOrigin, jsonError } from "@/server/http";
import { readUploads } from "@/server/files";
import { formObject } from "@/server/actions/safe";

export const dynamic = "force-dynamic";

/** Engineer daily progress update (multipart: fields + optional "photos"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await authorize("ENGINEER");
    assertRateLimit(`update:${user.id}`, 60, 60 * 60_000);
    const { id } = await params;
    const form = await req.formData();
    const update = await addDailyUpdate(id, formObject(form), user, await readUploads(form, "photos"));
    return NextResponse.json({ ok: true, id: update.id });
  } catch (err) {
    return jsonError(err, "daily update");
  }
}
