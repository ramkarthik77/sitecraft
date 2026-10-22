import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

/** Blob storage for published files and uploaded assets. */
export interface Storage {
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  init(): Promise<void>;
}

function safeKey(key: string): string {
  if (key.includes("..") || key.startsWith("/") || key.includes("\\")) throw new Error(`Invalid storage key ${key}`);
  return key;
}

class FsStorage implements Storage {
  private root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  async init() {
    await mkdir(this.root, { recursive: true });
  }
  private path(key: string) {
    const p = resolve(join(this.root, safeKey(key)));
    if (!p.startsWith(this.root + sep)) throw new Error("Storage path escapes root");
    return p;
  }
  async put(key: string, body: Buffer | string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  constructor(private cfg: Extract<Config["storage"], { driver: "s3" }>) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
    });
  }
  async init() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as { name?: string }).name === "NotFound") {
        // Local MinIO starts empty; create the bucket on first boot.
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
        return;
      }
      // Bucket-scoped tokens (common with R2) may not be allowed to inspect
      // the bucket itself; reads and writes are checked on first use.
      console.warn(`Couldn't check bucket "${this.cfg.bucket}" (${status ?? (e as Error).message}); continuing.`);
    }
  }
  async put(key: string, body: Buffer | string, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }));
  }
}

export function createStorage(cfg: Config["storage"]): Storage {
  return cfg.driver === "s3" ? new S3Storage(cfg) : new FsStorage(cfg.dir);
}

export function contentTypeFor(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (file.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".gif")) return "image/gif";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
