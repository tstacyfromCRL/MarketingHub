import { describe, expect, it } from 'vitest';
import { bannerOverlaySvg, photoPlacement, sampleFrame } from './graphicFrame';

describe('sample post frame', () => {
  it('keeps the logo in the banner and the headline clear of it', () => {
    const frame = sampleFrame(1080, 1350);
    expect(frame.bandY).toBeGreaterThan(800);
    expect(frame.logo.y).toBeGreaterThanOrEqual(frame.bandY);
    expect(frame.logo.x + frame.logo.width).toBeLessThanOrEqual(1080);
    expect(frame.headline.x + frame.headline.width).toBeLessThanOrEqual(frame.logo.x);
    expect(frame.peak).toBeGreaterThan(0);
  });

  it('does not stretch a small library photo across the canvas', () => {
    const placed = photoPlacement({ x: 0, y: 0, width: 1080, height: 900 }, { width: 320, height: 180 });
    expect(placed.fit).toBe('contain');
    expect(placed.width).toBe(640);
    expect(placed.height).toBe(360);
    expect(placed.x).toBeGreaterThan(100);
  });

  it('covers the photo area when the picture is already large', () => {
    const placed = photoPlacement({ x: 0, y: 0, width: 1080, height: 900 }, { width: 1600, height: 900 });
    expect(placed.fit).toBe('cover');
    expect(placed.width).toBe(1080);
  });

  it('draws the accent color into the banner pattern and the chevron', () => {
    const svg = bannerOverlaySvg(200, 80, 16, '#a42131');
    expect(svg).toContain('#a42131');
    expect(svg).toContain('L100 2');
  });
});
