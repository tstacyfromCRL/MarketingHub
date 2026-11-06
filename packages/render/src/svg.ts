import { pathSvgData, type DesignDoc, type Layer } from '@mh/shared';
import { escapeXml, sniffMime, visibleLayers, wrapText, type ImageResolver } from './common';

const FIT: Record<string, string> = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', fill: 'none' };

async function layerSvg(layer: Layer, resolve: ImageResolver): Promise<string> {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  let transform = layer.rotation ? ` transform="rotate(${layer.rotation} ${cx} ${cy})"` : '';
  const opacity = layer.opacity < 1 ? ` opacity="${layer.opacity}"` : '';
  let inner = '';
  switch (layer.type) {
    case 'rect': {
      const stroke = layer.stroke && layer.strokeWidth ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}"` : '';
      inner = `<rect x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" rx="${layer.cornerRadius}" fill="${layer.fill}"${stroke}/>`;
      break;
    }
    case 'ellipse': {
      const stroke = layer.stroke && layer.strokeWidth ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}"` : '';
      inner = `<ellipse cx="${cx}" cy="${cy}" rx="${layer.width / 2}" ry="${layer.height / 2}" fill="${layer.fill}"${stroke}/>`;
      break;
    }
    case 'image': {
      const data = await resolve(layer.src);
      const href = `data:${sniffMime(data)};base64,${data.toString('base64')}`;
      inner = `<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${FIT[layer.fit]}" href="${href}"/>`;
      break;
    }
    case 'text': {
      const lines = wrapText(layer);
      const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const x = layer.align === 'center' ? cx : layer.align === 'right' ? layer.x + layer.width : layer.x;
      const lh = layer.fontSize * layer.lineHeight;
      const tspans = lines
        .map((line, i) => `<tspan x="${x}" y="${layer.y + layer.fontSize + i * lh}">${escapeXml(line) || ' '}</tspan>`)
        .join('');
      const tracking = layer.letterSpacing ? ` letter-spacing="${layer.letterSpacing}"` : '';
      const underline = layer.underline ? ' text-decoration="underline"' : '';
      inner = `<text font-family="${escapeXml(layer.fontFamily)}" font-size="${layer.fontSize}" font-weight="${layer.fontWeight}"${layer.italic ? ' font-style="italic"' : ''}${tracking}${underline} fill="${layer.color}" text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
      break;
    }
    case 'path': {
      // Local points, then the same top-left rotation the editor uses.
      const fill = layer.fill === 'none' ? 'none' : layer.fill;
      const stroke = layer.stroke && layer.strokeWidth ? ` stroke="${layer.stroke}" stroke-width="${layer.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"` : '';
      inner = `<path d="${pathSvgData(layer.points, layer.closed)}" fill="${fill}"${stroke}/>`;
      transform = ` transform="translate(${layer.x} ${layer.y})${layer.rotation ? ` rotate(${layer.rotation})` : ''}"`;
      break;
    }
  }
  const id = escapeXml(layer.name.replace(/\s+/g, '_'));
  return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(layer.name)}"${transform}${opacity}>${inner}</g>`;
}

export interface SvgOptions {
  /** Render only these layers (used to rasterize single PSD layers). */
  only?: Layer[];
  /** Omit the document background color. */
  transparent?: boolean;
}

/** SVG with one named top-level group per layer; Illustrator and Affinity import them as layers. */
export async function toSvg(doc: DesignDoc, resolve: ImageResolver, opts: SvgOptions = {}): Promise<string> {
  const layers = opts.only ?? visibleLayers(doc);
  const parts = await Promise.all(layers.map((l) => layerSvg(l, resolve)));
  const bg = opts.transparent
    ? ''
    : `<g id="Background" inkscape:groupmode="layer" inkscape:label="Background"><rect width="${doc.width}" height="${doc.height}" fill="${doc.background}"/></g>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">` +
    bg +
    parts.join('') +
    `</svg>`
  );
}
