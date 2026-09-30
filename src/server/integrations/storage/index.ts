import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

let provider: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (provider) return provider;
  const e = env();
  if (e.STORAGE_PROVIDER === "s3") {
    const missing = (["STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`S3 storage is selected but ${missing.join(", ")} is not configured.`);
    provider = new S3StorageProvider({
      bucket: e.STORAGE_BUCKET!,
      region: e.STORAGE_REGION,
      accessKeyId: e.STORAGE_ACCESS_KEY!,
      secretAccessKey: e.STORAGE_SECRET_KEY!,
      endpoint: e.STORAGE_ENDPOINT,
      forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
    });
  } else {
    provider = new LocalStorageProvider(e.STORAGE_LOCAL_DIR);
  }
  return provider;
}

/** Test hook. */
export function setStorageProvider(p: StorageProvider | null) {
  provider = p;
}

export function storageKey(orderId: string, folder: "images" | "documents" | "progress", ext: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "bin";
  return `orders/${orderId}/${folder}/${randomUUID()}.${safeExt}`;
}

export function storageStatus() {
  const e = env();
  if (e.STORAGE_PROVIDER === "s3") {
    const configured = Boolean(e.STORAGE_BUCKET && e.STORAGE_ACCESS_KEY && e.STORAGE_SECRET_KEY);
    return {
      provider: "S3-compatible",
      configured,
      detail: configured ? `Bucket "${e.STORAGE_BUCKET}"${e.STORAGE_ENDPOINT ? ` at ${new URL(e.STORAGE_ENDPOINT).host}` : ""}` : "Missing bucket or credentials",
    };
  }
  return { provider: "Local disk (development only)", configured: true, detail: e.STORAGE_LOCAL_DIR };
}

export type { StorageProvider } from "./types";
