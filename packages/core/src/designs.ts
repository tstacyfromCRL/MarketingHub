import crypto from 'node:crypto';
import { prisma, type Prisma } from '@mh/db';
import { designDocSchema, type DesignDoc, type ExportFormat } from '@mh/shared';
import { EXPORT_MIME, exportDesign, toPreview } from '@mh/render';
import { config } from './config';
import { newStorageKey, storage } from './storage';

export const resolveStoredImage = (key: string) => storage.get(key);

/** Creates or updates a design and refreshes its preview image. */
export async function saveDesign(input: { id?: string; name: string; doc: DesignDoc; userId: string }) {
  const doc = designDocSchema.parse(input.doc);
  const preview = await toPreview(doc, resolveStoredImage);
  const previewKey = newStorageKey('previews', 'png');
  await storage.put(previewKey, preview, 'image/png');
  const data = { name: input.name, doc: doc as unknown as Prisma.InputJsonValue, previewKey };
  if (input.id) {
    const old = await prisma.design.findUniqueOrThrow({ where: { id: input.id } });
    const updated = await prisma.design.update({ where: { id: input.id }, data });
    if (old.previewKey) await storage.delete(old.previewKey).catch(() => undefined);
    return updated;
  }
  return prisma.design.create({ data: { ...data, createdById: input.userId } });
}

export async function renderDesignFile(designId: string, format: ExportFormat) {
  const design = await prisma.design.findUniqueOrThrow({ where: { id: designId } });
  const doc = designDocSchema.parse(design.doc);
  const body = await exportDesign(doc, format, resolveStoredImage);
  const safe = design.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design';
  return { body, filename: `${safe}-${doc.width}x${doc.height}.${format}`, mime: EXPORT_MIME[format] };
}

// ---------------------------------------------------------------------------
// Signed public media URLs: Instagram, TikTok and Ayrshare fetch media from a URL.
// ---------------------------------------------------------------------------

function sign(key: string, exp: number) {
  return crypto.createHmac('sha256', config.JWT_SECRET).update(`${key}:${exp}`).digest('base64url');
}

export function signedMediaUrl(key: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${config.PUBLIC_API_URL}/public/media/${key}?exp=${exp}&sig=${sign(key, exp)}`;
}

export function verifyMediaSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = sign(key, exp);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Renders a design to PNG and stores it so it can be uploaded or served to a platform. */
export async function renderDesignMedia(designId: string): Promise<{ key: string; png: Buffer }> {
  const { body } = await renderDesignFile(designId, 'png');
  const key = newStorageKey('media', 'png');
  await storage.put(key, body, 'image/png');
  return { key, png: body };
}
