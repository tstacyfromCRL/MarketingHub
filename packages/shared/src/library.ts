import { z } from 'zod';

export const DEFAULT_LIBRARY_NAME = 'Marketing & Media Drive';

/** The team library location, chosen once by an admin and shared with every user. */
export const libraryLocationSchema = z.object({
  name: z.string().trim().min(1).default(DEFAULT_LIBRARY_NAME),
  /** The folder as the admin selected it, e.g. "V:\\" or "V:\\Brand Assets". */
  rootPath: z.string().min(1),
  /** The same folder as a network path, e.g. "\\\\server\\share\\Brand Assets". Null for local folders. */
  uncPath: z.string().nullable().default(null),
});
export type LibraryLocation = z.infer<typeof libraryLocationSchema>;

export const libraryNotFoundMessage = (name: string) => `${name} not found. Please contact Admin for access`;

export type LibraryStatus =
  | { state: 'unset'; name: string }
  | { state: 'ok'; name: string; path: string; rootPath: string; uncPath: string | null }
  | { state: 'unavailable'; name: string; rootPath: string | null; uncPath: string | null; reason: string };

/** A drive letter mapped to a network share on this PC, e.g. { letter: 'V', remote: '\\\\server\\share' }. */
export interface DriveMapping {
  letter: string;
  remote: string;
}

const trimSlashes = (s: string) => s.replace(/[\\/]+$/, '');
const isUnc = (p: string) => /^\\\\[^\\]+\\[^\\]+/.test(p);

/** Converts a path on a mapped drive to its network (UNC) path, or null if the drive isn't a network drive. */
export function toUncPath(localPath: string, mappings: DriveMapping[]): string | null {
  if (isUnc(localPath)) return trimSlashes(localPath);
  const m = /^([a-zA-Z]):(.*)$/.exec(localPath);
  if (!m) return null;
  const map = mappings.find((x) => x.letter.toUpperCase() === m[1].toUpperCase());
  if (!map) return null;
  const rest = trimSlashes(m[2]);
  return trimSlashes(map.remote) + (rest && !rest.startsWith('\\') ? `\\${rest}` : rest);
}

/**
 * Where this PC should read the team library from, or null if the drive isn't mapped here.
 * Network libraries are matched by share, so users may map it to any drive letter.
 */
export function resolveLibraryPath(loc: Pick<LibraryLocation, 'rootPath' | 'uncPath'>, mappings: DriveMapping[]): string | null {
  if (!loc.uncPath) return loc.rootPath;
  if (isUnc(loc.rootPath)) return loc.rootPath;
  const target = trimSlashes(loc.uncPath).toLowerCase();
  for (const map of mappings) {
    const share = trimSlashes(map.remote).toLowerCase();
    if (target === share || target.startsWith(`${share}\\`)) {
      return `${map.letter.toUpperCase()}:${loc.uncPath.slice(share.length) || '\\'}`;
    }
  }
  return null;
}

export type AssetKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';

const EXT_KIND: Record<string, AssetKind> = {
  jpg: 'IMAGE', jpeg: 'IMAGE', png: 'IMAGE', gif: 'IMAGE', webp: 'IMAGE', tif: 'IMAGE', tiff: 'IMAGE', bmp: 'IMAGE', heic: 'IMAGE', svg: 'IMAGE',
  psd: 'IMAGE', ai: 'IMAGE', eps: 'IMAGE', afdesign: 'IMAGE', afphoto: 'IMAGE',
  mp4: 'VIDEO', mov: 'VIDEO', avi: 'VIDEO', mkv: 'VIDEO', webm: 'VIDEO', m4v: 'VIDEO', wmv: 'VIDEO',
  pdf: 'DOCUMENT', doc: 'DOCUMENT', docx: 'DOCUMENT', ppt: 'DOCUMENT', pptx: 'DOCUMENT', txt: 'DOCUMENT', md: 'DOCUMENT', indd: 'DOCUMENT',
};

export function assetKindForPath(p: string): AssetKind {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? 'OTHER';
}

/** Normalizes a path relative to the library root to forward slashes, so it is identical on every PC. */
export function toRelPath(root: string, absolute: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const a = norm(absolute);
  if (a.toLowerCase() === r.toLowerCase()) return '';
  if (!a.toLowerCase().startsWith(r.toLowerCase() + '/')) throw new Error(`${absolute} is outside ${root}`);
  return a.slice(r.length + 1);
}
