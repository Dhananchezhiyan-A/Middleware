import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, type ReadStream } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * Storage abstraction for uploaded files (CSV imports, error reports).
 *
 * Phase 1: local disk driver (STORAGE_LOCAL_DIR) with an S3-compatible
 * interface designed-in. Keys are ALWAYS generated server-side — client
 * filenames never influence paths (path-traversal safe).
 */

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  put(buffer: Buffer, opts: { contentType: string; prefix: string; checksum?: string }): Promise<StoredObject>;
  getPath(key: string): string;
  createReadStream(key: string): ReadStream;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): boolean;
}

const UNSAFE = /[^a-zA-Z0-9._-]/g;

/** Strips directories/separators/etc. from a client-provided filename. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "upload";
  const cleaned = base.replace(UNSAFE, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 100) || "upload";
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
  }

  async put(
    buffer: Buffer,
    opts: { contentType: string; prefix: string; checksum?: string },
  ): Promise<StoredObject> {
    const checksum =
      opts.checksum ?? createHash("sha256").update(buffer).digest("hex");
    const key = `${sanitizeFileName(opts.prefix)}/${checksum.slice(0, 32)}-${randomBytes(6).toString("hex")}.csv`;
    const full = this.getPath(key);
    // The prefix directory (e.g. `imports/`) may not exist yet on a fresh
    // install — create it, otherwise the very first upload fails.
    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(full, buffer);
    return { key, size: buffer.length, contentType: opts.contentType };
  }

  getPath(key: string): string {
    const normalized = normalize(key).replace(/^([/\\])+/, "");
    const full = resolve(this.root, normalized);
    // Defense-in-depth: the resolved path must stay inside the root.
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new Error("Storage key escapes the storage root.");
    }
    return full;
  }

  createReadStream(key: string): ReadStream {
    return createReadStream(this.getPath(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.getPath(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.getPath(key));
  }

  exists(key: string): boolean {
    return existsSync(this.getPath(key));
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") {
    // S3 driver ships behind the same interface; it requires explicit
    // configuration and is intentionally NOT silently faked.
    throw new Error(
      "S3 storage driver is not implemented in Phase 1. Set STORAGE_DRIVER=local.",
    );
  }
  const dir = process.env.STORAGE_LOCAL_DIR ?? "./storage";
  driver = new LocalStorageDriver(isAbsolute(dir) ? dir : join(process.cwd(), dir));
  return driver;
}
