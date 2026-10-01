import type { DesignDoc, ExportFormat } from '@mh/shared';
import type { ImageResolver } from './common';
import { toPng } from './raster';
import { toPsd } from './psd';
import { toSvg } from './svg';
import { toPdf } from './pdf';
import { toIdml } from './idml';

export * from './common';
export { toSvg } from './svg';
export { toPng, toPreview, rasterizeLayer } from './raster';
export { toPsd } from './psd';
export { toPdf } from './pdf';
export { toIdml } from './idml';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  psd: 'image/vnd.adobe.photoshop',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  idml: 'application/vnd.adobe.indesign-idml-package',
};

export async function exportDesign(doc: DesignDoc, format: ExportFormat, resolve: ImageResolver): Promise<Buffer> {
  switch (format) {
    case 'png':
      return toPng(doc, resolve);
    case 'psd':
      return toPsd(doc, resolve);
    case 'svg':
      return Buffer.from(await toSvg(doc, resolve), 'utf8');
    case 'pdf':
      return toPdf(doc, resolve);
    case 'idml':
      return toIdml(doc, resolve);
  }
}
