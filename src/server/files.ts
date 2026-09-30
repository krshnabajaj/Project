import { NextResponse } from "next/server";
import { storage } from "./integrations/storage";
import { contentDisposition } from "./http";

/** Stream an object after authorization, or redirect to a short-lived signed URL. */
export async function serveObject(key: string, fileName: string, contentType: string, download: boolean) {
  const signed = await storage().signedUrl(key, { expiresInSeconds: 300, downloadName: download ? fileName : undefined, contentType });
  if (signed) return NextResponse.redirect(signed, { headers: { "Cache-Control": "private, no-store" } });
  const obj = await storage().get(key);
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(obj.body.length),
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", fileName),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

export async function readUploads(form: FormData, field: string) {
  const files = form.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  return Promise.all(files.map(async (f) => ({ name: f.name || "photo.jpg", type: f.type, buffer: Buffer.from(await f.arrayBuffer()) })));
}
