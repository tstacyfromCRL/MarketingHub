import { zipEntries } from './zipPack';

/**
 * A draft download is one zip. Unzipping it leaves a folder named after the social post,
 * with the graphic as a PNG and the words as a text file. The folder name has to be one
 * Windows can create, because that is where the files land.
 */
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function draftFolderName(title: string): string {
  const cleaned = title.replace(INVALID_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  const clipped = Array.from(cleaned).slice(0, 80).join('').trim().replace(/[. ]+$/g, '');
  if (!clipped) return 'Social post';
  if (RESERVED_NAME.test(clipped)) return `${clipped} post`;
  return clipped;
}

export interface DraftVariantSource {
  platform: string;
  label: string;
  body: string;
  designId: string | null;
}

export interface DraftGraphicSlot {
  designId: string;
  /** Set when this post has more than one graphic, so the file name says which network it is for. */
  platformLabel?: string;
}

/**
 * One file per distinct graphic. A post that shares one graphic across networks stays a single PNG.
 * A different graphic per network keeps each one, named for that network, in the same folder.
 */
export function draftGraphicSlots(input: { designId: string | null; variants: DraftVariantSource[] }): DraftGraphicSlot[] {
  const ordered: DraftGraphicSlot[] = [];
  const seen = new Set<string>();
  const push = (designId: string | null, platformLabel?: string) => {
    if (!designId || seen.has(designId)) return;
    seen.add(designId);
    ordered.push({ designId, platformLabel });
  };
  for (const variant of input.variants) push(variant.designId ?? input.designId, variant.label);
  if (ordered.length === 0) push(input.designId);
  if (ordered.length === 1) {
    const only = ordered[0];
    return only ? [{ designId: only.designId }] : [];
  }
  return ordered;
}

/** copy.txt is the post copy. A network is added only when its words differ from that copy. */
export function draftCopyText(input: { body: string; variants: { label: string; body: string }[] }): string {
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();
  const base = normalize(input.body);
  const extras = input.variants
    .map((variant) => ({ label: variant.label, body: normalize(variant.body) }))
    .filter((variant) => variant.body.length > 0 && variant.body !== base);
  const parts: string[] = [];
  if (base) parts.push(base);
  for (const variant of extras) parts.push(`${variant.label}\n${variant.body}`);
  if (!parts.length) return '';
  return `${parts.join('\n\n')}\n`;
}

function fileSlug(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'graphic';
}

export function draftGraphicFileNames(slots: DraftGraphicSlot[]): string[] {
  if (slots.length === 1 && !slots[0]?.platformLabel) return ['graphic.png'];
  const used = new Set<string>();
  return slots.map((slot, index) => {
    const base = slot.platformLabel ? `graphic-${fileSlug(slot.platformLabel)}` : `graphic-${index + 1}`;
    let name = `${base}.png`;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n}.png`;
      n += 1;
    }
    used.add(name);
    return name;
  });
}

function pngFor(pngByDesignId: Map<string, Buffer> | Record<string, Buffer>, designId: string): Buffer | undefined {
  return pngByDesignId instanceof Map ? pngByDesignId.get(designId) : pngByDesignId[designId];
}

/** The zip filename matches the folder inside it, so the download and the unpacked folder share the post title. */
export function buildDraftPack(input: {
  title: string;
  body: string;
  designId: string | null;
  variants: DraftVariantSource[];
  pngByDesignId: Map<string, Buffer> | Record<string, Buffer>;
}): { filename: string; folder: string; body: Buffer } {
  const folder = draftFolderName(input.title);
  const slots = draftGraphicSlots(input);
  const names = draftGraphicFileNames(slots);
  const files: { name: string; data: Buffer }[] = [
    { name: `${folder}/copy.txt`, data: Buffer.from(draftCopyText(input), 'utf8') },
  ];
  slots.forEach((slot, index) => {
    const png = pngFor(input.pngByDesignId, slot.designId);
    if (!png) throw new Error(`Missing PNG for design ${slot.designId}`);
    files.push({ name: `${folder}/${names[index]}`, data: png });
  });
  return { filename: `${folder}.zip`, folder, body: zipEntries(files) };
}
