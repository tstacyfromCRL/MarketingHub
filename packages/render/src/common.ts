import type { DesignDoc, Layer, TextLayer } from '@mh/shared';

/** Loads the bytes for an image layer's `src` (a storage key). */
export type ImageResolver = (src: string) => Promise<Buffer>;

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Approximate average glyph width as a fraction of font size (sans-serif). */
const AVG_CHAR = 0.52;

/**
 * Wraps text to the layer width. Uses a width estimate so every exporter wraps identically;
 * the design editor uses the same function to keep previews consistent.
 */
export function wrapText(layer: Pick<TextLayer, 'text' | 'fontSize' | 'width' | 'fontWeight'>): string[] {
  const charW = layer.fontSize * AVG_CHAR * (layer.fontWeight === 'bold' ? 1.08 : 1);
  const maxChars = Math.max(1, Math.floor(layer.width / charW));
  const out: string[] = [];
  for (const para of layer.text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > maxChars && line) {
        out.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export function sniffMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.subarray(0, 5).toString().startsWith('<svg') || buf.subarray(0, 5).toString() === '<?xml') return 'image/svg+xml';
  return 'application/octet-stream';
}

export function visibleLayers(doc: DesignDoc): Layer[] {
  return doc.layers.filter((l) => l.visible);
}

/** Parses #rrggbb into 0..1 components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}
