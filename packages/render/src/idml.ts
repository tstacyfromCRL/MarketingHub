import JSZip from 'jszip';
import sharp from 'sharp';
import type { DesignDoc, Layer, TextLayer } from '@mh/shared';
import { escapeXml, hexToRgb, type ImageResolver } from './common';

const NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const DOM = 'DOMVersion="18.0"';

/**
 * Minimal InDesign Markup (IDML) package: one page, one InDesign layer per design layer,
 * shapes as frames, text as live text frames, and images embedded in graphic frames.
 */
export async function toIdml(doc: DesignDoc, resolve: ImageResolver): Promise<Buffer> {
  const W = doc.width;
  const H = doc.height;
  const colors = new Map<string, string>();
  const colorRef = (hex: string) => {
    const k = hex.toLowerCase().replace('#', '');
    if (!colors.has(k)) colors.set(k, `Color/c_${k}`);
    return colors.get(k)!;
  };

  // Page sits at (0, -H/2) in spread coordinates for a single, non-facing page.
  const box = (l: { x: number; y: number; width: number; height: number }) => {
    const x0 = l.x, y0 = l.y - H / 2, x1 = l.x + l.width, y1 = l.y + l.height - H / 2;
    const pts = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]
      .map(([x, y]) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}"/>`)
      .join('');
    return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${pts}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
  };
  const rotate = (l: Layer) => {
    if (!l.rotation) return 'ItemTransform="1 0 0 1 0 0"';
    const r = (l.rotation * Math.PI) / 180;
    const cx = l.x + l.width / 2, cy = l.y + l.height / 2 - H / 2;
    const c = Math.cos(r), s = Math.sin(r);
    return `ItemTransform="${c} ${s} ${-s} ${c} ${cx - c * cx + s * cy} ${cy - s * cx - c * cy}"`;
  };

  const layerDefs: string[] = [`<Layer Self="lyr_bg" Name="Background" Visible="true" Locked="false"/>`];
  const items: string[] = [
    `<Rectangle Self="bg" ItemLayer="lyr_bg" ContentType="Unassigned" FillColor="${colorRef(doc.background)}" StrokeWeight="0" ItemTransform="1 0 0 1 0 0">${box({ x: 0, y: 0, width: W, height: H })}</Rectangle>`,
  ];
  const stories: { id: string; xml: string }[] = [];

  let n = 0;
  for (const layer of doc.layers) {
    n++;
    const lid = `lyr_${n}`;
    layerDefs.push(`<Layer Self="${lid}" Name="${escapeXml(layer.name)}" Visible="${layer.visible}" Locked="${layer.locked}"/>`);
    const common = `ItemLayer="${lid}" ${rotate(layer)}`;
    const opacity = layer.opacity < 1 ? `<TransparencySetting><BlendingSetting Opacity="${Math.round(layer.opacity * 100)}"/></TransparencySetting>` : '';
    if (layer.type === 'rect' || layer.type === 'ellipse') {
      const tag = layer.type === 'rect' ? 'Rectangle' : 'Oval';
      const stroke = layer.stroke && layer.strokeWidth ? `StrokeColor="${colorRef(layer.stroke)}" StrokeWeight="${layer.strokeWidth}"` : 'StrokeWeight="0"';
      const corner = layer.type === 'rect' && layer.cornerRadius ? `CornerOption="RoundedCorner" CornerRadius="${layer.cornerRadius}"` : '';
      items.push(`<${tag} Self="it_${n}" ${common} ContentType="Unassigned" FillColor="${colorRef(layer.fill)}" ${stroke} ${corner}>${box(layer)}${opacity}</${tag}>`);
    } else if (layer.type === 'image') {
      const src = await resolve(layer.src);
      const w = Math.round(layer.width), h = Math.round(layer.height);
      const fit = layer.fit === 'contain' ? 'contain' : layer.fit === 'fill' ? 'fill' : 'cover';
      const png = await sharp(src).resize(w, h, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const x = layer.x, y = layer.y - H / 2;
      items.push(
        `<Rectangle Self="it_${n}" ${common} ContentType="GraphicType" FillColor="Swatch/None" StrokeWeight="0">${box(layer)}${opacity}` +
          `<Image Self="img_${n}" ItemTransform="1 0 0 1 ${x} ${y}" ActualPpi="72 72" EffectivePpi="72 72">` +
          `<Properties><Contents><![CDATA[${png.toString('base64')}]]></Contents>` +
          `<GraphicBounds Left="0" Top="0" Right="${w}" Bottom="${h}"/></Properties></Image></Rectangle>`,
      );
    } else if (layer.type === 'text') {
      const sid = `st_${n}`;
      items.push(
        `<TextFrame Self="it_${n}" ParentStory="${sid}" ${common} ContentType="TextType" FillColor="Swatch/None" StrokeWeight="0">${box(layer)}${opacity}` +
          `<TextFramePreference TextColumnCount="1" VerticalJustification="TopAlign" FirstBaselineOffset="AscentOffset"/></TextFrame>`,
      );
      stories.push({ id: sid, xml: storyXml(sid, layer, colorRef(layer.color)) });
    } else if (layer.type === 'path') {
      const fill = layer.fill === 'none' ? 'Swatch/None' : colorRef(layer.fill);
      const stroke = layer.stroke && layer.strokeWidth ? `StrokeColor="${colorRef(layer.stroke)}" StrokeWeight="${layer.strokeWidth}"` : 'StrokeWeight="0"';
      items.push(`<Polygon Self="it_${n}" ${common} ContentType="Unassigned" FillColor="${fill}" ${stroke}>${pathGeometry(layer, H)}${opacity}</Polygon>`);
    }
  }

  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.adobe.indesign-idml-package', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`,
  );
  zip.file(
    'designmap.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(0)" ?>` +
      `<Document xmlns:idPkg="${NS}" ${DOM} Self="d" StoryList="${stories.map((s) => s.id).join(' ')}" ActiveLayer="lyr_bg">` +
      `<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>` +
      layerDefs.join('') +
      `<idPkg:Spread src="Spreads/Spread_sp1.xml"/>` +
      stories.map((s) => `<idPkg:Story src="Stories/Story_${s.id}.xml"/>`).join('') +
      `<idPkg:BackingStory src="XML/BackingStory.xml"/></Document>`,
  );
  zip.file(
    'Resources/Graphic.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Graphic xmlns:idPkg="${NS}" ${DOM}>` +
      `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>` +
      `<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper"/>` +
      [...colors.entries()]
        .map(([hex, ref]) => {
          const { r, g, b } = hexToRgb(`#${hex}`);
          return `<Color Self="${ref}" Model="Process" Space="RGB" ColorValue="${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}" Name="#${hex}"/>`;
        })
        .join('') +
      `<Swatch Self="Swatch/None" Name="None"/></idPkg:Graphic>`,
  );
  zip.file('Resources/Fonts.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Fonts xmlns:idPkg="${NS}" ${DOM}/>`);
  zip.file(
    'Resources/Styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Styles xmlns:idPkg="${NS}" ${DOM}>` +
      `<RootCharacterStyleGroup Self="rcsg"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/></RootCharacterStyleGroup>` +
      `<RootParagraphStyleGroup Self="rpsg"><ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]"/>` +
      `<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle"/></RootParagraphStyleGroup>` +
      `<RootObjectStyleGroup Self="rosg"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/></RootObjectStyleGroup></idPkg:Styles>`,
  );
  zip.file(
    'Resources/Preferences.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Preferences xmlns:idPkg="${NS}" ${DOM}>` +
      `<DocumentPreference PageHeight="${H}" PageWidth="${W}" PagesPerDocument="1" FacingPages="false"/>` +
      `<ViewPreference HorizontalMeasurementUnits="Pixels" VerticalMeasurementUnits="Pixels"/></idPkg:Preferences>`,
  );
  zip.file(
    'Spreads/Spread_sp1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Spread xmlns:idPkg="${NS}" ${DOM}>` +
      `<Spread Self="sp1" PageCount="1" BindingLocation="0" ItemTransform="1 0 0 1 0 0">` +
      `<Page Self="pg1" Name="1" GeometricBounds="0 0 ${H} ${W}" ItemTransform="1 0 0 1 0 ${-H / 2}"/>` +
      items.join('') +
      `</Spread></idPkg:Spread>`,
  );
  for (const s of stories) zip.file(`Stories/Story_${s.id}.xml`, s.xml);
  zip.file('XML/BackingStory.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:BackingStory xmlns:idPkg="${NS}" ${DOM}><XmlStory Self="bs"/></idPkg:BackingStory>`);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' });
}

function pathGeometry(layer: Extract<Layer, { type: 'path' }>, pageHeight: number): string {
  const pts = layer.points.map((point) => {
    const ax = layer.x + point.x;
    const ay = layer.y + point.y - pageHeight / 2;
    return `<PathPointType Anchor="${ax} ${ay}" LeftDirection="${ax + (point.inX ?? 0)} ${ay + (point.inY ?? 0)}" RightDirection="${ax + (point.outX ?? 0)} ${ay + (point.outY ?? 0)}"/>`;
  }).join('');
  return `<Properties><PathGeometry><GeometryPathType PathOpen="${layer.closed ? 'false' : 'true'}"><PathPointArray>${pts}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

function storyXml(id: string, layer: TextLayer, color: string): string {
  const just = layer.align === 'center' ? 'CenterAlign' : layer.align === 'right' ? 'RightAlign' : 'LeftAlign';
  const style = [layer.fontWeight === 'bold' ? 'Bold' : '', layer.italic ? 'Italic' : ''].join(' ').trim() || 'Regular';
  const paras = layer.text.split('\n').map((p) => `<Content>${escapeXml(p)}</Content>`).join('<Br/>');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><idPkg:Story xmlns:idPkg="${NS}" ${DOM}>` +
    `<Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="${escapeXml(layer.name)}">` +
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="${just}">` +
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="${layer.fontSize}" FillColor="${color}" FontStyle="${style}"${layer.letterSpacing ? ` Tracking="${Math.round((layer.letterSpacing / layer.fontSize) * 1000)}"` : ''}${layer.underline ? ' Underline="true"' : ''}>` +
    `<Properties><AppliedFont type="string">${escapeXml(layer.fontFamily)}</AppliedFont><Leading type="unit">${layer.fontSize * layer.lineHeight}</Leading></Properties>` +
    paras +
    `</CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>`
  );
}
