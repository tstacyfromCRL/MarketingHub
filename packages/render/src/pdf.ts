import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFDict,
  PDFString,
  StandardFonts,
  rgb,
  type PDFRef,
  type PDFFont,
} from 'pdf-lib';
import type { DesignDoc, Layer } from '@mh/shared';
import { hexToRgb, wrapText, type ImageResolver } from './common';
import { rasterizeLayerPng } from './raster';

/**
 * PDF where every design layer is an Optional Content Group, which Illustrator, Affinity and
 * Acrobat show as separate layers. Shapes and text stay vector; images are embedded.
 */
export async function toPdf(doc: DesignDoc, resolve: ImageResolver): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([doc.width, doc.height]);
  const ctx = pdf.context;
  const fonts: Record<string, PDFFont> = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const ocgRefs: PDFRef[] = [];
  const properties = ctx.obj({}) as PDFDict;
  const resources = page.node.Resources()!;
  resources.set(PDFName.of('Properties'), properties);

  const beginLayer = (name: string) => {
    const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) }));
    ocgRefs.push(ref);
    const tag = `OC${ocgRefs.length}`;
    properties.set(PDFName.of(tag), ref);
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(tag)]));
  };
  const endLayer = () => page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  const flipY = (y: number, h: number) => doc.height - y - h;

  beginLayer('Background');
  const bg = hexToRgb(doc.background);
  page.drawRectangle({ x: 0, y: 0, width: doc.width, height: doc.height, color: rgb(bg.r, bg.g, bg.b) });
  endLayer();

  for (const layer of doc.layers as Layer[]) {
    if (!layer.visible) continue;
    beginLayer(layer.name);
    const vector = !layer.rotation && layer.type !== 'image';
    if (vector && layer.type === 'rect') {
      const c = hexToRgb(layer.fill);
      const s = layer.stroke ? hexToRgb(layer.stroke) : null;
      page.drawRectangle({
        x: layer.x, y: flipY(layer.y, layer.height), width: layer.width, height: layer.height,
        color: rgb(c.r, c.g, c.b), opacity: layer.opacity,
        borderColor: s ? rgb(s.r, s.g, s.b) : undefined, borderWidth: s ? layer.strokeWidth : 0,
      });
    } else if (vector && layer.type === 'ellipse') {
      const c = hexToRgb(layer.fill);
      page.drawEllipse({
        x: layer.x + layer.width / 2, y: flipY(layer.y + layer.height / 2, 0),
        xScale: layer.width / 2, yScale: layer.height / 2, color: rgb(c.r, c.g, c.b), opacity: layer.opacity,
      });
    } else if (vector && layer.type === 'text') {
      const c = hexToRgb(layer.color);
      const key = layer.fontWeight === 'bold' ? (layer.italic ? 'boldItalic' : 'bold') : layer.italic ? 'italic' : 'normal';
      const font = fonts[key];
      const lh = layer.fontSize * layer.lineHeight;
      const charset = new Set(font.getCharacterSet());
      wrapText(layer).forEach((raw, i) => {
        // Standard PDF fonts only cover WinAnsi; drop anything else (e.g. emoji) rather than failing.
        const line = [...raw].filter((ch) => charset.has(ch.codePointAt(0)!)).join('');
        const w = font.widthOfTextAtSize(line, layer.fontSize);
        const x = layer.align === 'center' ? layer.x + (layer.width - w) / 2 : layer.align === 'right' ? layer.x + layer.width - w : layer.x;
        page.drawText(line, {
          x, y: doc.height - (layer.y + layer.fontSize + i * lh), size: layer.fontSize, font,
          color: rgb(c.r, c.g, c.b), opacity: layer.opacity,
        });
      });
    } else {
      const png = await pdf.embedPng(await rasterizeLayerPng(doc, layer, resolve));
      page.drawImage(png, { x: 0, y: 0, width: doc.width, height: doc.height, opacity: layer.opacity });
    }
    endLayer();
  }

  pdf.catalog.set(
    PDFName.of('OCProperties'),
    ctx.obj({ OCGs: ocgRefs, D: { Order: ocgRefs, ON: ocgRefs, Name: PDFString.of('Layers') } }),
  );
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
