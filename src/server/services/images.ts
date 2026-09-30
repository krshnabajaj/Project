import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { maxUploadBytes } from "@/lib/env";
import { canPerform, MAX_MACHINE_PHOTOS } from "@/lib/workflow";
import { statusLabel } from "@/lib/status";
import type { Actor } from "../actor";
import { audit, AUDIT } from "../audit";
import { storage, storageKey } from "../integrations/storage";
import { assertAssignedEngineer, lockOrder } from "./access";
import { systemLog, errorMessage } from "../system-log";

export interface UploadFile {
  name: string;
  type: string;
  buffer: Buffer;
}

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  fileName: string;
  mimeType: "image/jpeg";
  size: number;
}

const ALLOWED_IMAGE_EXT = /\.(jpe?g|png)$/i;

/**
 * Validate by content (not just extension/MIME), auto-rotate from EXIF, strip
 * metadata (GPS etc.), downscale to max 2560px and re-encode as JPEG.
 */
export async function processImage(file: UploadFile): Promise<ProcessedImage> {
  if (file.buffer.length === 0) throw new AppError(`"${file.name}" is empty.`, "VALIDATION");
  const limit = maxUploadBytes();
  if (file.buffer.length > limit) {
    throw new AppError(`"${file.name}" is ${(file.buffer.length / 1048576).toFixed(1)} MB — the maximum is ${(limit / 1048576).toFixed(0)} MB.`, "LIMIT");
  }
  if (!ALLOWED_IMAGE_EXT.test(file.name)) throw new AppError(`"${file.name}": only JPG, JPEG and PNG images are allowed.`, "VALIDATION");
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    throw new AppError(`"${file.name}" is not a valid image.`, "VALIDATION");
  }
  if (meta.format !== "jpeg" && meta.format !== "png") {
    throw new AppError(`"${file.name}" is not a JPG or PNG image.`, "VALIDATION");
  }
  const { data, info } = await sharp(file.buffer, { limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "_").slice(0, 80) || "photo";
  return { buffer: data, width: info.width, height: info.height, fileName: `${base}.jpg`, mimeType: "image/jpeg", size: data.length };
}

/** Store processed images; returns keys. Caller must clean up with removeStored on failure. */
export async function storeImages(orderId: string, images: ProcessedImage[], folder: "images" | "progress") {
  const keys: string[] = [];
  try {
    for (const img of images) {
      const key = storageKey(orderId, folder, "jpg");
      await storage().put(key, img.buffer, img.mimeType);
      keys.push(key);
    }
  } catch (err) {
    await removeStored(keys);
    throw new AppError(`Could not store photographs: ${errorMessage(err)}`, "INTEGRATION");
  }
  return keys;
}

export async function removeStored(keys: string[]) {
  for (const k of keys) {
    try {
      await storage().delete(k);
    } catch (err) {
      await systemLog("WARN", "storage", `Could not delete orphaned object ${k}: ${errorMessage(err)}`);
    }
  }
}

/** Engineer uploads machine photographs (max 8 per order, until photos are submitted). */
export async function uploadMachinePhotos(orderId: string, files: UploadFile[], actor: Actor) {
  if (!files.length) throw new AppError("Select at least one photograph.", "VALIDATION");
  if (files.length > MAX_MACHINE_PHOTOS) throw new AppError(`Maximum ${MAX_MACHINE_PHOTOS} photographs per order.`, "LIMIT");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found.", "NOT_FOUND");
  assertAssignedEngineer(actor, order);
  if (!canPerform("UPLOAD_PHOTO", "ENGINEER", order.status)) {
    throw new AppError(`Photographs cannot be uploaded while the order is "${statusLabel(order.status)}".`, "INVALID_TRANSITION");
  }
  const existing = await prisma.orderImage.count({ where: { orderId, kind: "MACHINE" } });
  if (existing + files.length > MAX_MACHINE_PHOTOS) {
    throw new AppError(`Maximum ${MAX_MACHINE_PHOTOS} photographs per order. This order already has ${existing}; you can add ${MAX_MACHINE_PHOTOS - existing} more.`, "LIMIT");
  }

  const processed: ProcessedImage[] = [];
  for (const f of files) processed.push(await processImage(f));
  const keys = await storeImages(orderId, processed, "images");

  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      assertAssignedEngineer(actor, fresh);
      if (fresh.photosSubmittedAt || !canPerform("UPLOAD_PHOTO", "ENGINEER", fresh.status)) {
        throw new AppError("Photographs have already been submitted for this order.", "INVALID_TRANSITION");
      }
      // Re-count under the lock so parallel uploads can never exceed the limit.
      const count = await tx.orderImage.count({ where: { orderId, kind: "MACHINE" } });
      if (count + processed.length > MAX_MACHINE_PHOTOS) {
        throw new AppError(`Maximum ${MAX_MACHINE_PHOTOS} photographs per order. This order already has ${count}.`, "LIMIT");
      }
      const created = [];
      for (let i = 0; i < processed.length; i++) {
        const p = processed[i]!;
        created.push(
          await tx.orderImage.create({
            data: { orderId, kind: "MACHINE", uploadedById: actor.id!, storageKey: keys[i]!, fileName: p.fileName, mimeType: p.mimeType, size: p.size, width: p.width, height: p.height },
          }),
        );
      }
      await audit(tx, actor, {
        action: AUDIT.PHOTO_UPLOADED,
        summary: `${actor.name} uploaded ${created.length} photograph${created.length === 1 ? "" : "s"}`,
        orderId,
        entityType: "order_image",
        newValue: { files: created.map((c) => c.fileName), total: count + created.length },
      });
      return created;
    });
  } catch (err) {
    await removeStored(keys);
    throw err;
  }
}

/** Delete/replace a machine photo before the photos are submitted. */
export async function deleteMachinePhoto(imageId: string, actor: Actor) {
  const img = await prisma.orderImage.findUnique({ where: { id: imageId }, include: { order: true } });
  if (!img || img.kind !== "MACHINE") throw new AppError("Photograph not found.", "NOT_FOUND");
  if (actor.role === "ENGINEER") assertAssignedEngineer(actor, img.order);
  else if (actor.role !== "ADMIN") throw new AppError("Not allowed.", "FORBIDDEN");
  if (img.order.photosSubmittedAt) throw new AppError("Photographs cannot be deleted after they have been submitted.", "INVALID_TRANSITION");

  await prisma.$transaction(async (tx) => {
    await tx.orderImage.delete({ where: { id: imageId } });
    await audit(tx, actor, {
      action: AUDIT.PHOTO_DELETED,
      summary: `${actor.name} deleted photograph "${img.fileName}"`,
      orderId: img.orderId,
      entityType: "order_image",
      entityId: imageId,
      oldValue: { fileName: img.fileName },
    });
  });
  await removeStored([img.storageKey]);
}
