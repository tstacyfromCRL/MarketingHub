import { describe, expect, it } from 'vitest';
import { libraryCardProductTags, libraryScanBar, missingAfterControlledScan, missingAfterScan, shellThumbnailBlocksUi } from './library';

describe('missingAfterScan', () => {
  const existing = [
    { id: '1', relPath: 'Photos/Hero.JPG' },
    { id: '2', relPath: 'Photos/Detail.png' },
  ];

  it('does not wipe the library when the walker saw nothing', () => {
    expect(missingAfterScan(existing, [])).toEqual([]);
  });

  it('treats Windows path casing as the same file', () => {
    expect(missingAfterScan(existing, ['photos/hero.jpg'])).toEqual(['2']);
  });

  it('keeps confirm and reject on unconfirmed product tags', () => {
    const tags = libraryCardProductTags([
      { productId: 'a', confirmed: true },
      { productId: 'b', confirmed: false },
      { productId: 'c', confirmed: null },
      { productId: 'd', confirmed: true },
      { productId: 'e', confirmed: true },
      { productId: 'f', confirmed: null },
    ]);
    expect(tags.map((tag) => tag.productId)).toEqual(['c', 'f', 'a', 'd']);
    expect(tags.filter((tag) => tag.confirmed === null).map((tag) => tag.productId)).toEqual(['c', 'f']);
  });

  it('hides the import total until every file has been counted', () => {
    expect(libraryScanBar('finding', 40, 0)).toBeNull();
    expect(libraryScanBar('indexing', 0, 0)).toBe(100);
    expect(libraryScanBar('indexing', 10, 4)).toBe(40);
    expect(libraryScanBar('indexing', 10, 10)).toBe(100);
    expect(libraryScanBar('indexing', 10, 12)).toBe(100);
  });

  it('skips shell thumbnails for design files and video, which freeze typing on Windows', () => {
    expect(shellThumbnailBlocksUi('Brand/logo.psd')).toBe(true);
    expect(shellThumbnailBlocksUi('Brand/logo.PSD')).toBe(true);
    expect(shellThumbnailBlocksUi('Film/booth.mp4')).toBe(true);
    expect(shellThumbnailBlocksUi('Photos/hero.jpg')).toBe(false);
    expect(shellThumbnailBlocksUi('Photos/hero.png')).toBe(false);
    expect(shellThumbnailBlocksUi('Notes/brief.pdf')).toBe(false);
  });

  it('keeps unseen files when an import is cancelled', () => {
    const existing = [
      { id: '1', relPath: 'Photos/Hero.JPG' },
      { id: '2', relPath: 'Photos/Detail.png' },
    ];
    expect(missingAfterControlledScan(existing, ['Photos/Hero.JPG'], true)).toEqual([]);
    expect(missingAfterControlledScan(existing, ['Photos/Hero.JPG'], false)).toEqual(['2']);
  });

  it('marks only files that were not seen', () => {
    expect(missingAfterScan(existing, ['Photos/Hero.JPG', 'Photos/Detail.png'])).toEqual([]);
    expect(missingAfterScan(existing, ['Photos/Hero.JPG'])).toEqual(['2']);
  });
});
