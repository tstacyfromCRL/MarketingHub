import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, resolveFromRoot } from './config';
import { randomToken } from './crypto';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
  }
  async get(key: string) {
    return fs.readFile(this.file(key));
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  private ready: Promise<void> | null = null;
  constructor(private bucket: string) {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: Boolean(config.S3_ENDPOINT),
      credentials:
        config.S3_ACCESS_KEY && config.S3_SECRET_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
          : undefined,
    });
  }
  private ensureBucket() {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })();
    return this.ready;
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const storage: Storage =
  config.STORAGE_DRIVER === 's3'
    ? new S3Storage(config.S3_BUCKET)
    : new LocalStorage(resolveFromRoot(config.LOCAL_STORAGE_DIR));

export function newStorageKey(prefix: string, ext: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `${prefix}/${d}/${randomToken(12)}.${ext.replace(/^\./, '')}`;
}

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  psd: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  idml: 'application/vnd.adobe.indesign-idml-package',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

export function mimeForKey(key: string): string {
  return MIME_BY_EXT[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
