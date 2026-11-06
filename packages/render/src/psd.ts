import { writePsdBuffer, type Layer as PsdLayer, type Psd } from 'ag-psd';
import sharp from 'sharp';
import type { DesignDoc, TextLayer } from '@mh/shared';
import { hexToRgb, wrapText, type ImageResolver } from './common';
import { rasterizeLayer } from './raster';
import { toSvg } from './svg';

function postscriptName(layer: TextLayer): string {
  const family = layer.fontFamily.replace(/\s+/g, '');
  if (family.toLowerCase() === 'arial') return layer.fontWeight === 'bold' ? 'Arial-BoldMT' : 'ArialMT';
  return layer.fontWeight === 'bold' ? `${family}-Bold` : family;
}

/**
 * Layered PSD: one pixel layer per design layer, with text layers carrying live text data so
 * Photoshop / Affinity / Photopea keep them editable.
 */
export async function toPsd(doc: DesignDoc, resolve: ImageResolver): Promise<Buffer> {
  const children: PsdLayer[] = [];

  const bg = Buffer.alloc(doc.width * doc.height * 4);
  const { r, g, b } = hexToRgb(doc.background);
  for (let i = 0; i < bg.length; i += 4) {
    bg[i] = Math.round(r * 255);
    bg[i + 1] = Math.round(g * 255);
    bg[i + 2] = Math.round(b * 255);
    bg[i + 3] = 255;
  }
  children.push({
    name: 'Background',
    top: 0,
    left: 0,
    imageData: { width: doc.width, height: doc.height, data: new Uint8ClampedArray(bg.buffer, bg.byteOffset, bg.byteLength) },
  });

  for (const layer of doc.layers) {
    const imageData = await rasterizeLayer(doc, layer, resolve);
    const psdLayer: PsdLayer = {
      name: layer.name,
      top: 0,
      left: 0,
      opacity: layer.opacity,
      hidden: !layer.visible,
      imageData,
    };
    if (layer.type === 'text' && !layer.rotation) {
      const color = hexToRgb(layer.color);
      const x = layer.align === 'center' ? layer.x + layer.width / 2 : layer.align === 'right' ? layer.x + layer.width : layer.x;
      psdLayer.text = {
        text: wrapText(layer).join('\r'),
        transform: [1, 0, 0, 1, x, layer.y + layer.fontSize],
        style: {
          font: { name: postscriptName(layer) },
          fontSize: layer.fontSize,
          fillColor: { r: color.r * 255, g: color.g * 255, b: color.b * 255 },
          leading: layer.fontSize * layer.lineHeight,
          autoLeading: false,
          tracking: layer.letterSpacing ? Math.round((layer.letterSpacing / layer.fontSize) * 1000) : undefined,
          underline: layer.underline || undefined,
        },
        paragraphStyle: { justification: layer.align },
      };
    }
    children.push(psdLayer);
  }

  const composite = await sharp(Buffer.from(await toSvg(doc, resolve))).ensureAlpha().raw().toBuffer();
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    imageData: { width: doc.width, height: doc.height, data: new Uint8ClampedArray(composite.buffer, composite.byteOffset, composite.byteLength) },
    children,
  };
  return Buffer.from(writePsdBuffer(psd, { invalidateTextLayers: true, generateThumbnail: false }));
}
