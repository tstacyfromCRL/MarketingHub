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

/**
 * Windows builds these previews on the Electron main process, which is also what delivers
 * keystrokes. A single PSD or video can block that process for half a minute, so typing in any
 * field waits. Those files are still indexed; they just have no thumbnail.
 */
const SHELL_THUMBNAIL_BLOCKS_UI = new Set([
  'psd', 'psb', 'ai', 'eps', 'afdesign', 'afphoto', 'tif', 'tiff', 'heic',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv',
]);

export function shellThumbnailBlocksUi(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return SHELL_THUMBNAIL_BLOCKS_UI.has(ext);
}

export const LIBRARY_IMPORT_KINDS = ['FOLDER', 'FILE'] as const;
export type LibraryImportKind = (typeof LIBRARY_IMPORT_KINDS)[number];

/** Forward slashes, no leading or trailing slash. Empty string is the drive root. */
export function normalizeImportPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * A file people can still browse, but vision, embeddings, product matching, and generated
 * graphics must ignore. A folder hold covers the folder itself and everything inside it.
 */
export function assetHiddenFromAi(relPath: string, holds: { relPath: string; kind: LibraryImportKind }[]): boolean {
  const rel = normalizeImportPath(relPath);
  return holds.some((hold) => {
    const root = normalizeImportPath(hold.relPath);
    if (hold.kind === 'FILE') return root.toLowerCase() === rel.toLowerCase();
    if (root === '') return true;
    return root.toLowerCase() === rel.toLowerCase() || isInsideImport(root, rel);
  });
}

/** True when `relPath` is strictly inside a folder import (`folderRel` of "" is the drive root). */
export function isInsideImport(folderRel: string, relPath: string): boolean {
  const folder = normalizeImportPath(folderRel);
  const rel = normalizeImportPath(relPath);
  if (folder.toLowerCase() === rel.toLowerCase()) return false;
  if (folder === '') return true;
  return rel.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
}

/**
 * Drops imports already covered by a folder. A newly added parent folder replaces the narrower
 * files and folders inside it. A folder wins over a file with the same path.
 */
export function collapseLibraryImports<T extends { relPath: string; kind: LibraryImportKind }>(items: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const item of items) {
    const relPath = normalizeImportPath(item.relPath);
    const key = relPath.toLowerCase();
    const prev = byPath.get(key);
    if (!prev || item.kind === 'FOLDER') byPath.set(key, { ...item, relPath });
  }
  const list = [...byPath.values()];
  return list.filter((item) => !list.some((other) => other.kind === 'FOLDER' && isInsideImport(other.relPath, item.relPath)));
}

/**
 * Product names shown under a library thumbnail.
 * Rejected matches stay off the card. Every unconfirmed (orange) suggestion is included
 * so confirm and reject can sit on that tag. Confirmed names fill a few remaining slots
 * and do not get those buttons.
 */
export function libraryCardProductTags<T extends { confirmed: boolean | null }>(products: T[], confirmedLimit = 2): T[] {
  const pending = products.filter((product) => product.confirmed === null);
  const confirmed = products.filter((product) => product.confirmed === true).slice(0, confirmedLimit);
  return [...pending, ...confirmed];
}

export type LibraryScanState = 'idle' | 'scanning' | 'paused' | 'busy' | 'error' | 'done' | 'cancelled';
export type LibraryScanPhase = 'finding' | 'indexing';

/** Progress for a library import. `found` is the walk total. `indexed` is how many of those are in the library. */
export interface LibraryScanProgress {
  state: LibraryScanState;
  phase: LibraryScanPhase;
  found: number;
  indexed: number;
  seen: number;
  uploaded: number;
  message?: string;
}

/**
 * Width of the import bar, as a percent.
 * The total is unknown while files are still being counted, so the bar stays indeterminate.
 */
export function libraryScanBar(phase: LibraryScanPhase, found: number, indexed: number): number | null {
  if (phase === 'finding') return null;
  if (found <= 0) return 100;
  return Math.min(100, Math.round((indexed / found) * 100));
}

/**
 * Files to drop after a scan.
 * Cancel is not a finished walk: files the scanner has not reached stay in the library.
 */
export function missingAfterControlledScan(existing: { id: string; relPath: string }[], seenPaths: string[], releaseOnly: boolean): string[] {
  if (releaseOnly) return [];
  return missingAfterScan(existing, seenPaths);
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

/**
 * After a scan, which indexed files were not seen on disk.
 * An empty seen list must not wipe the library (failed/empty walker).
 * Paths compare case-insensitively for Windows shares.
 */
export function missingAfterScan(existing: { id: string; relPath: string }[], seenPaths: string[]): string[] {
  if (seenPaths.length === 0) return [];
  const seen = new Set(seenPaths.map((rel) => rel.toLowerCase()));
  return existing.filter((asset) => !seen.has(asset.relPath.toLowerCase())).map((asset) => asset.id);
}
