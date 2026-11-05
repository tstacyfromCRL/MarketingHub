import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDraftPack, draftCopyText, draftFolderName, draftGraphicFileNames, draftGraphicSlots, type DraftVariantSource } from './draftPack';
import { unzipToDirectory, zipDirectory } from './zipPack';

const facebook = Buffer.from('facebook-png');
const instagram = Buffer.from('instagram-png');

function variants(partials: Partial<DraftVariantSource>[]): DraftVariantSource[] {
  return partials.map((variant, index) => ({
    platform: variant.platform ?? `network-${index}`,
    label: variant.label ?? `Network ${index}`,
    body: variant.body ?? 'Shared copy',
    designId: variant.designId ?? null,
  }));
}

describe('draft download pack', () => {
  it('names the folder after the post and keeps characters a folder name cannot use', () => {
    expect(draftFolderName('Spring Expo booth')).toBe('Spring Expo booth');
    expect(draftFolderName('Booth: Spring/Expo?')).toBe('Booth Spring Expo');
    expect(draftFolderName('   ')).toBe('Social post');
    expect(draftFolderName('CON')).toBe('CON post');
    expect(draftFolderName('Hello...')).toBe('Hello');
  });

  it('uses one PNG when every network shares a graphic, and one PNG per network when they differ', () => {
    expect(draftGraphicSlots({
      designId: 'shared',
      variants: variants([
        { label: 'Facebook', designId: 'shared' },
        { label: 'Instagram', designId: 'shared' },
      ]),
    })).toEqual([{ designId: 'shared' }]);
    expect(draftGraphicFileNames([{ designId: 'shared' }])).toEqual(['graphic.png']);

    const slots = draftGraphicSlots({
      designId: 'fb',
      variants: variants([
        { label: 'Facebook', designId: 'fb' },
        { label: 'Instagram', designId: 'ig' },
      ]),
    });
    expect(slots).toEqual([
      { designId: 'fb', platformLabel: 'Facebook' },
      { designId: 'ig', platformLabel: 'Instagram' },
    ]);
    expect(draftGraphicFileNames(slots)).toEqual(['graphic-facebook.png', 'graphic-instagram.png']);
  });

  it('keeps the post copy in one text file and adds a network only when its words differ', () => {
    expect(draftCopyText({
      body: 'Visit the booth.',
      variants: [{ label: 'Facebook', body: 'Visit the booth.' }],
    })).toBe('Visit the booth.\n');
    expect(draftCopyText({
      body: 'Visit the booth.',
      variants: [{ label: 'X', body: 'Visit the booth. #expo' }],
    })).toBe('Visit the booth.\n\nX\nVisit the booth. #expo\n');
  });

  it('packs the PNG and the copy inside a folder titled with the post', async () => {
    const pack = buildDraftPack({
      title: 'Spring Expo booth',
      body: 'Come see the X200.',
      designId: 'shared',
      variants: variants([
        { label: 'Facebook', body: 'Come see the X200.', designId: 'shared' },
        { label: 'Instagram', body: 'Come see the X200. #x200', designId: 'ig' },
      ]),
      pngByDesignId: { shared: facebook, ig: instagram },
    });
    expect(pack.filename).toBe('Spring Expo booth.zip');
    expect(pack.folder).toBe('Spring Expo booth');

    const dest = await mkdtemp(path.join(tmpdir(), 'draft-pack-'));
    try {
      await unzipToDirectory(pack.body, dest);
      expect(await readFile(path.join(dest, 'Spring Expo booth', 'copy.txt'), 'utf8')).toBe(
        'Come see the X200.\n\nInstagram\nCome see the X200. #x200\n',
      );
      expect(await readFile(path.join(dest, 'Spring Expo booth', 'graphic-facebook.png'))).toEqual(facebook);
      expect(await readFile(path.join(dest, 'Spring Expo booth', 'graphic-instagram.png'))).toEqual(instagram);
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });

  it('still writes a directory zip when the files were saved to disk first', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'draft-dir-'));
    const unpacked = await mkdtemp(path.join(tmpdir(), 'draft-dir-out-'));
    try {
      await mkdir(path.join(dir, 'Spring Expo booth'));
      await writeFile(path.join(dir, 'Spring Expo booth', 'copy.txt'), 'Hello\n');
      await unzipToDirectory(await zipDirectory(dir), unpacked);
      expect(await readFile(path.join(unpacked, 'Spring Expo booth', 'copy.txt'), 'utf8')).toBe('Hello\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(unpacked, { recursive: true, force: true });
    }
  });
});
