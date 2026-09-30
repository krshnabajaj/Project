import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider, StoredObject } from "./types";

/**
 * Development-only provider. Files are written outside the public web root and
 * are only ever served through the authorized /api/files routes.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<StoredObject> {
    const full = this.resolve(key);
    const body = await fs.readFile(full);
    let contentType = "application/octet-stream";
    try {
      contentType = JSON.parse(await fs.readFile(`${full}.meta.json`, "utf8")).contentType ?? contentType;
    } catch {
      /* metadata optional */
    }
    return { body, contentType };
  }

  async delete(key: string) {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
    await fs.rm(`${full}.meta.json`, { force: true });
  }

  async signedUrl() {
    return null;
  }
}
