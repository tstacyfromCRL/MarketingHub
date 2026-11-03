import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mh/db';
import { brandKitSchema, BRAND_KIT_FILE_KINDS, type BrandKit, type BrandProfileInput } from '@mh/shared';
import { z } from 'zod';
import { newStorageKey, storage } from './storage';

/** The zip is how a brand kit moves to a computer that does not share this server. */
export class BrandKitError extends Error {}

const emptyBrand = (): BrandProfileInput => ({
  companyName: '',
  summary: '',
  website: '',
  tagline: '',
  mission: '',
  voice: '',
  visualIdentity: '',
  audience: '',
  colors: [],
  fonts: [],
  dos: [],
  donts: [],
});

/** Reads kit.json and checks that every listed file stays inside the kit's files folder. */
export async function loadBrandKit(dir: string): Promise<BrandKit> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, 'kit.json'), 'utf8');
  } catch {
    throw new BrandKitError('kit.json: This file is not a brand kit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BrandKitError('kit.json: The brand kit file is not valid JSON.');
  }
  const result = brandKitSchema.safeParse(parsed);
  if (!result.success) throw new BrandKitError(zodMessage(result.error));
  for (const file of result.data.files) kitFileOnDisk(dir, file.path);
  return result.data;
}

/**
 * Writes the saved company profile and kit files (logos, backgrounds, overlays, font files).
 * Example posts are not included; they are reference pictures, not pieces of the kit.
 */
export async function exportBrandKit(orgId: string, dir: string): Promise<void> {
  const brand = await prisma.brandProfile.findUnique({ where: { organizationId: orgId } });
  const rows = await prisma.brandFile.findMany({
    where: { kind: { in: [...BRAND_KIT_FILE_KINDS] } },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
  });
  const files: BrandKit['files'] = [];
  for (const [index, row] of rows.entries()) {
    const rel = kitFilePath(index, row.name);
    const bytes = await storage.get(row.storageKey);
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    files.push({ kind: row.kind as BrandKit['files'][number]['kind'], name: row.name, mime: row.mime, path: rel });
  }
  const doc: BrandKit = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    brand: brand
      ? {
          companyName: brand.companyName,
          summary: brand.summary,
          website: brand.website,
          tagline: brand.tagline,
          mission: brand.mission,
          voice: brand.voice,
          visualIdentity: brand.visualIdentity,
          audience: brand.audience,
          colors: brandKitSchema.shape.brand.shape.colors.parse(brand.colors),
          fonts: brandKitSchema.shape.brand.shape.fonts.parse(brand.fonts),
          dos: brand.dos,
          donts: brand.donts,
        }
      : emptyBrand(),
    files,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'kit.json'), JSON.stringify(doc, null, 2));
}

/**
 * Replaces this computer's brand kit with the zip. Kit files already here are removed.
 * Example posts, generated images, and exports are left in place.
 */
export async function importBrandKit(orgId: string, dir: string): Promise<{ files: number }> {
  const kit = await loadBrandKit(dir);
  const written: { key: string; file: BrandKit['files'][number]; size: number }[] = [];
  try {
    for (const file of kit.files) {
      const bytes = await readFile(kitFileOnDisk(dir, file.path));
      const key = newStorageKey(`brand/${file.kind.toLowerCase()}`, extension(file.name, file.mime));
      await storage.put(key, bytes, file.mime);
      written.push({ key, file, size: bytes.length });
    }
    const previous = await prisma.brandFile.findMany({ where: { kind: { in: [...BRAND_KIT_FILE_KINDS] } } });
    await prisma.$transaction(async (tx) => {
      const profile = await tx.brandProfile.findUnique({ where: { organizationId: orgId } });
      if (!profile) await tx.brandProfile.create({ data: { organizationId: orgId, ...kit.brand } });
      else await tx.brandProfile.update({ where: { id: profile.id }, data: kit.brand });
      await tx.brandFile.deleteMany({ where: { kind: { in: [...BRAND_KIT_FILE_KINDS] } } });
      if (written.length) {
        await tx.brandFile.createMany({
          data: written.map(({ key, file, size }) => ({ kind: file.kind, name: file.name, storageKey: key, mime: file.mime, size })),
        });
      }
    });
    for (const row of previous) await storage.delete(row.storageKey).catch(() => undefined);
    return { files: written.length };
  } catch (err) {
    for (const item of written) await storage.delete(item.key).catch(() => undefined);
    throw err;
  }
}

function kitFilePath(index: number, name: string): string {
  const base = name.replace(/[\\/]/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
  return `files/${String(index + 1).padStart(3, '0')}-${base}`;
}

/** A kit may only point at files inside its own files folder. */
function kitFileOnDisk(dir: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/');
  if (!cleaned.startsWith('files/') || cleaned.split('/').includes('..')) {
    throw new BrandKitError(`${rel}: A brand kit file must stay inside the files folder.`);
  }
  const root = path.resolve(dir, 'files');
  const full = path.resolve(dir, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) throw new BrandKitError(`${rel}: A brand kit file must stay inside the files folder.`);
  return full;
}

function extension(name: string, mime: string): string {
  const fromName = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  if (fromName && !['exe', 'js', 'html', 'htm', 'svgz'].includes(fromName)) return fromName;
  const fromMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
  };
  return fromMime[mime] ?? 'bin';
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `kit.json ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n') || 'kit.json: This file is not a brand kit.';
}
