import sharp from 'sharp';
import type { DesignDoc, Layer } from '@mh/shared';
import { toSvg } from './svg';
import type { ImageResolver } from './common';

export async function toPng(doc: DesignDoc, resolve: ImageResolver): Promise<Buffer> {
  const svg = await toSvg(doc, resolve);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Renders a small preview (longest edge `max` px). */
export async function toPreview(doc: DesignDoc, resolve: ImageResolver, max = 480): Promise<Buffer> {
  const png = await toPng(doc, resolve);
  return sharp(png).resize(max, max, { fit: 'inside' }).png().toBuffer();
}

/** Renders a single layer on a transparent, document-sized canvas as raw RGBA. */
export async function rasterizeLayer(doc: DesignDoc, layer: Layer, resolve: ImageResolver) {
  const svg = await toSvg(doc, resolve, { only: [{ ...layer, opacity: 1, visible: true }], transparent: true });
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

export async function rasterizeLayerPng(doc: DesignDoc, layer: Layer, resolve: ImageResolver): Promise<Buffer> {
  const svg = await toSvg(doc, resolve, { only: [{ ...layer, opacity: 1, visible: true }], transparent: true });
  return sharp(Buffer.from(svg)).png().toBuffer();
}
