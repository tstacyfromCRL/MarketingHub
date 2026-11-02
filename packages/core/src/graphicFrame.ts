/** Geometry for a graphic that follows the saved sample posts: photo, then a dark banner. */

export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SampleFrame {
  bandY: number;
  bandH: number;
  /** How far the chevron rises into the photo. */
  peak: number;
  pad: number;
  logo: FrameBox;
  headline: FrameBox & { fontSize: number };
  subline: FrameBox & { fontSize: number };
}

/** Banner, logo, and type placement. The logo sits in the banner so it does not float on the photo. */
export function sampleFrame(width: number, height: number): SampleFrame {
  const portrait = height > width * 1.1;
  const bandH = Math.round(height * (portrait ? 0.28 : 0.34));
  const bandY = height - bandH;
  const peak = Math.max(18, Math.round(width * 0.045));
  const pad = Math.round(width * 0.05);
  const logoSize = Math.round(bandH * 0.46);
  const logo = { x: width - pad - logoSize, y: bandY + Math.round((bandH - logoSize) / 2), width: logoSize, height: logoSize };
  const textW = Math.max(40, logo.x - pad * 2);
  const fontSize = Math.round(Math.min(width, height) * (portrait ? 0.055 : 0.068));
  const headline = { x: pad, y: bandY + Math.round(bandH * 0.14), width: textW, height: Math.round(bandH * 0.42), fontSize };
  const subline = {
    x: pad,
    y: headline.y + headline.height,
    width: textW,
    height: Math.round(bandH * 0.28),
    fontSize: Math.round(fontSize * 0.48),
  };
  return { bandY, bandH, peak, pad, logo, headline, subline };
}

/**
 * Where a library photo sits above the banner. A small thumbnail is kept near its own size
 * so it is not stretched across the canvas. A large photo covers the photo area.
 */
export function photoPlacement(area: FrameBox, image: { width: number; height: number }): FrameBox & { fit: 'cover' | 'contain' } {
  const large = image.width >= area.width * 0.75 && image.height >= area.height * 0.45;
  if (large) return { ...area, fit: 'cover' };
  const scale = Math.min(area.width / image.width, area.height / image.height, 2);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
    fit: 'contain',
  };
}

/** Red chevron and the cube line pattern used on the sample posts. Transparent outside the strokes. */
export function bannerOverlaySvg(width: number, bandHeight: number, peak: number, stroke: string): string {
  const cubes: string[] = [];
  const cell = 130;
  const rows = Math.ceil(bandHeight / (cell * 0.55)) + 1;
  const cols = Math.ceil(width / cell) + 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cell + (row % 2 ? cell / 2 : 0) - cell;
      const y = peak + row * cell * 0.5;
      const s = 28;
      cubes.push(
        `M${x} ${y + s * 0.5} L${x + s} ${y} L${x + s * 2} ${y + s * 0.5} L${x + s} ${y + s} Z ` +
          `M${x} ${y + s * 0.5} L${x} ${y + s * 1.4} L${x + s} ${y + s * 1.9} L${x + s} ${y + s} ` +
          `M${x + s * 2} ${y + s * 0.5} L${x + s * 2} ${y + s * 1.4} L${x + s} ${y + s * 1.9}`,
      );
    }
  }
  const mid = Math.round(width / 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight + peak}">` +
    `<g fill="none" stroke="${stroke}" stroke-width="1.6" opacity="0.7">${cubes.map((d) => `<path d="${d}"/>`).join('')}</g>` +
    `<path d="M0 ${peak} L${mid} 2 L${width} ${peak}" fill="none" stroke="${stroke}" stroke-width="10" stroke-linejoin="miter"/>` +
    `</svg>`
  );
}
