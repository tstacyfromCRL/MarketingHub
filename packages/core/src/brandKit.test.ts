import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import './config';
import { prisma } from '@mh/db';
import { BRAND_KIT_FILE_KINDS } from '@mh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { BrandKitError, exportBrandKit, importBrandKit, loadBrandKit } from './brandKit';
import { getDefaultOrgId } from './org';
import { newStorageKey, storage } from './storage';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const kitColor = { name: 'Kit green', hex: '#112233', tier: 'PRIMARY', format: 'HEX', value: '#112233' };

/** Puts the computer's kit back. These tests share the development database. */
async function restoreKit(
  orgId: string,
  profile: Awaited<ReturnType<typeof prisma.brandProfile.findUnique>>,
  files: { id: string; kind: string; name: string; storageKey: string; mime: string; size: number; createdAt: Date; bytes: Buffer | null }[],
) {
  if (profile) {
    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: {
        companyName: profile.companyName,
        summary: profile.summary,
        website: profile.website,
        tagline: profile.tagline,
        mission: profile.mission,
        voice: profile.voice,
        visualIdentity: profile.visualIdentity,
        audience: profile.audience,
        colors: profile.colors ?? [],
        fonts: profile.fonts ?? [],
        dos: profile.dos,
        donts: profile.donts,
      },
    });
  }
  await prisma.brandFile.deleteMany({ where: { kind: { in: [...BRAND_KIT_FILE_KINDS] } } });
  for (const file of files) {
    if (file.bytes) await storage.put(file.storageKey, file.bytes, file.mime);
    await prisma.brandFile.create({
      data: {
        id: file.id,
        kind: file.kind as 'LOGO',
        name: file.name,
        storageKey: file.storageKey,
        mime: file.mime,
        size: file.size,
        createdAt: file.createdAt,
      },
    });
  }
}

describe('brand kit', () => {
  const extra: string[] = [];

  afterAll(async () => {
    if (extra.length) await prisma.brandFile.deleteMany({ where: { id: { in: extra } } }).catch(() => undefined);
  });

  it('rejects a folder that is not a brand kit', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bad-kit-'));
    await writeFile(path.join(dir, 'kit.json'), '{}');
    await expect(loadBrandKit(dir)).rejects.toThrow(/kit\.json/);
    await expect(loadBrandKit(dir)).rejects.toBeInstanceOf(BrandKitError);
    await rm(dir, { recursive: true, force: true });
  });

  it('replaces the kit from a zip and leaves example posts in place', async () => {
    const orgId = await getDefaultOrgId();
    const profile = await prisma.brandProfile.findUnique({ where: { organizationId: orgId } });
    const previous = await prisma.brandFile.findMany({ where: { kind: { in: [...BRAND_KIT_FILE_KINDS] } } });
    const saved = [];
    for (const row of previous) {
      let bytes: Buffer | null = null;
      try {
        bytes = await storage.get(row.storageKey);
      } catch {
        bytes = null;
      }
      saved.push({ ...row, bytes });
    }
    const styleKey = newStorageKey('brand/style', 'png');
    const style = await prisma.brandFile.create({
      data: { kind: 'STYLE', name: 'keep-me.png', storageKey: styleKey, mime: 'image/png', size: png.length },
    });
    extra.push(style.id);
    await storage.put(styleKey, png, 'image/png');

    const incoming = await mkdtemp(path.join(tmpdir(), 'brand-kit-'));
    const packed = await mkdtemp(path.join(tmpdir(), 'brand-kit-zip-'));
    try {
      await mkdir(path.join(incoming, 'files'), { recursive: true });
      await writeFile(path.join(incoming, 'kit.json'), JSON.stringify({
        schemaVersion: 1,
        exportedAt: '2026-11-03T00:00:00.000Z',
        brand: {
          companyName: 'Portable Co',
          summary: 'Moved from another computer.',
          website: '',
          tagline: '',
          mission: '',
          voice: 'Plain and specific.',
          visualIdentity: 'Green field, white type.',
          audience: '',
          colors: [kitColor],
          fonts: [{ role: 'Headline', family: 'Source Serif 4' }],
          dos: ['Use the green'],
          donts: [],
        },
        files: [{ kind: 'LOGO', name: 'mark.png', mime: 'image/png', path: 'files/mark.png' }],
      }));
      await writeFile(path.join(incoming, 'files', 'mark.png'), png);

      const imported = await importBrandKit(orgId, incoming);
      expect(imported.files).toBe(1);
      const brand = await prisma.brandProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(brand.companyName).toBe('Portable Co');
      expect(brand.colors).toEqual([kitColor]);
      const logos = await prisma.brandFile.findMany({ where: { kind: 'LOGO' } });
      expect(logos).toHaveLength(1);
      expect(logos[0]?.name).toBe('mark.png');
      expect(await storage.get(logos[0]!.storageKey)).toEqual(png);
      expect(await prisma.brandFile.findUnique({ where: { id: style.id } })).toBeTruthy();

      const exported = await mkdtemp(path.join(tmpdir(), 'brand-kit-out-'));
      await exportBrandKit(orgId, exported);
      const roundTrip = await loadBrandKit(exported);
      expect(roundTrip.brand.companyName).toBe('Portable Co');
      expect(roundTrip.brand.fonts).toEqual([{ role: 'Headline', family: 'Source Serif 4' }]);
      expect(roundTrip.files).toHaveLength(1);
      expect(await readFile(path.join(exported, roundTrip.files[0]!.path))).toEqual(png);

      const { zipDirectory, unzipToDirectory } = await import('./zipPack');
      const zip = await zipDirectory(exported);
      await unzipToDirectory(zip, packed);
      const fromZip = await loadBrandKit(packed);
      expect(fromZip.files[0]?.name).toBe('mark.png');
      await rm(exported, { recursive: true, force: true });
    } finally {
      await restoreKit(orgId, profile, saved);
      await storage.delete(styleKey).catch(() => undefined);
      await prisma.brandFile.delete({ where: { id: style.id } }).catch(() => undefined);
      await rm(incoming, { recursive: true, force: true });
      await rm(packed, { recursive: true, force: true });
    }
  });
});
