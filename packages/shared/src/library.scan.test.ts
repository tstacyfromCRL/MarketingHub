import { describe, expect, it } from 'vitest';
import { missingAfterScan } from './library';

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

  it('marks only files that were not seen', () => {
    expect(missingAfterScan(existing, ['Photos/Hero.JPG', 'Photos/Detail.png'])).toEqual([]);
    expect(missingAfterScan(existing, ['Photos/Hero.JPG'])).toEqual(['2']);
  });
});
