import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider, StoredObject } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

/**
 * Works with AWS S3, Cloudflare R2 (endpoint https://<account>.r2.cloudflarestorage.com, region "auto"),
 * Supabase Storage (S3 endpoint https://<ref>.supabase.co/storage/v1/s3, forcePathStyle) and MinIO.
 * Objects are private; downloads use short-lived presigned URLs after the app authorizes the user.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private client: S3Client;

  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    const bytes = await res.Body.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async signedUrl(key: string, opts: { expiresInSeconds: number; downloadName?: string; contentType?: string }) {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, "_")}"`
        : undefined,
      ResponseContentType: opts.contentType,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.expiresInSeconds });
  }
}
