import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Cluster-wide job lease stored in the settings table (works with pooled
 * connections, multiple app instances and a separate worker process).
 * Returns null when another process holds the lease.
 */
export async function withLease<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const key = `lease:${name}`;
  const owner = randomUUID();
  const until = new Date(Date.now() + ttlMs).toISOString();
  const value = JSON.stringify({ owner, until });
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${value}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE (settings.value->>'until')::timestamptz < now()
    RETURNING key`;
  if (!rows.length) return null;
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`DELETE FROM settings WHERE key = ${key} AND value->>'owner' = ${owner}`;
  }
}
