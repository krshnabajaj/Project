export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** Object storage abstraction (S3 / Cloudflare R2 / Supabase Storage / MinIO / local dev). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Short-lived signed URL for direct download, or null if the provider streams through the app. */
  signedUrl(key: string, opts: { expiresInSeconds: number; downloadName?: string; contentType?: string }): Promise<string | null>;
}
