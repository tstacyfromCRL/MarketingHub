import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import JSZip from 'jszip';
import { readPsd } from 'ag-psd';
import type { DesignDoc } from '@mh/shared';
import { exportDesign } from './index';

const doc: DesignDoc = {
  version: 1,
  width: 400,
  height: 300,
  background: '#102030',
  layers: [
    { id: 'a', name: 'Photo', type: 'image', src: 'photo', x: 0, y: 0, width: 400, height: 200, rotation: 0, opacity: 1, visible: true, locked: false, fit: 'cover', role: 'generated' },
    { id: 'b', name: 'Band', type: 'rect', x: 0, y: 200, width: 400, height: 100, rotation: 0, opacity: 0.9, visible: true, locked: false, fill: '#ff6600', cornerRadius: 0, strokeWidth: 0 },
    { id: 'c', name: 'Headline', type: 'text', text: 'Fall launch – now shipping 🚀', x: 20, y: 215, width: 360, height: 70, rotation: 0, opacity: 1, visible: true, locked: false, fontFamily: 'Arial', fontSize: 28, fontWeight: 'bold', italic: false, color: '#ffffff', align: 'center', lineHeight: 1.2 },
  ],
};

const resolve = async () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#3366cc' } }).png().toBuffer();

describe('exporters', () => {
  it('renders a PNG at document size', async () => {
    const png = await exportDesign(doc, 'png', resolve);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
  });

  it('writes a PSD with one layer per design layer plus background, keeping live text', async () => {
    const buf = await exportDesign(doc, 'psd', resolve);
    const psd = readPsd(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as never, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    expect(psd.children?.map((l) => l.name)).toEqual(['Background', 'Photo', 'Band', 'Headline']);
    expect(psd.children?.[3].text?.text).toContain('Fall launch');
  });

  it('writes SVG layer groups and a layered PDF', async () => {
    const svg = (await exportDesign(doc, 'svg', resolve)).toString();
    expect(svg).toContain('inkscape:label="Headline"');
    const pdf = (await exportDesign(doc, 'pdf', resolve)).toString('latin1');
    expect(pdf).toContain('/OCProperties');
    expect(pdf.startsWith('%PDF')).toBe(true);
  });

  it('keeps a pen path as vectors in SVG, PDF, and IDML', async () => {
    const curved: DesignDoc = {
      ...doc,
      layers: [
        {
          id: 'p', name: 'Curve', type: 'path', x: 10, y: 20, width: 20, height: 10, rotation: 0, opacity: 1, visible: true, locked: false,
          points: [{ x: 0, y: 0, outX: 10, outY: 0 }, { x: 20, y: 10, inX: -10, inY: 0 }],
          closed: false, fill: 'none', stroke: '#111827', strokeWidth: 4,
        },
      ],
    };
    const svg = (await exportDesign(curved, 'svg', resolve)).toString();
    expect(svg).toContain('M 0 0 C 10 0 10 10 20 10');
    expect(svg).toContain('translate(10 20)');
    const pdf = await exportDesign(curved, 'pdf', resolve);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const zip = await JSZip.loadAsync(await exportDesign(curved, 'idml', resolve));
    const spread = await zip.file('Spreads/Spread_sp1.xml')!.async('string');
    expect(spread).toContain('PathPointType');
    expect(spread).toContain('Anchor="10 ');
  });

  it('writes an IDML package', async () => {
    const zip = await JSZip.loadAsync(await exportDesign(doc, 'idml', resolve));
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.adobe.indesign-idml-package');
    expect(Object.keys(zip.files)).toContain('Stories/Story_st_3.xml');
  });
});
