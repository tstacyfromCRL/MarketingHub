import { nativeImage, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assetKindForPath, toRelPath, type AssetKind, type LibraryScanProgress } from '@mh/shared';
import { api, ApiError } from './api';
import { checkAccess, currentStatus } from './library';
import { store } from './store';

export type ScanProgress = LibraryScanProgress;

const SKIP_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store', '$recycle.bin', 'system volume information']);
const BATCH = 40;
const RESCAN_MS = 30 * 60_000;

let running = false;
/** run keeps walking. pause waits between files. cancel stops without marking unseen files missing. */
let control: 'run' | 'pause' | 'cancel' = 'run';
let progress: ScanProgress = { state: 'idle', phase: 'finding', found: 0, indexed: 0, seen: 0, uploaded: 0 };
let sink: WebContents | null = null;

export const scanProgress = () => progress;

export function pauseLibraryScan(): ScanProgress {
  if (running && control === 'run') {
    control = 'pause';
    emit({ state: 'paused' });
  }
  return progress;
}

export function resumeLibraryScan(): ScanProgress {
  if (running && control === 'pause') {
    control = 'run';
    emit({ state: 'scanning' });
  }
  return progress;
}

export function cancelLibraryScan(): ScanProgress {
  if (running && control !== 'cancel') {
    control = 'cancel';
    emit({ state: 'cancelled', message: 'Cancelling…' });
  }
  return progress;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function setProgressSink(wc: WebContents) {
  sink = wc;
}

function emit(p: Partial<ScanProgress>) {
  progress = { ...progress, ...p };
  if (sink && !sink.isDestroyed()) sink.send('library:progress', progress);
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.opendir(dir);
  } catch {
    return;
  }
  for await (const e of entries) {
    const name = e.name.toLowerCase();
    if (SKIP_NAMES.has(name) || name.startsWith('~$') || name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

/** Shell thumbnails for PSDs/videos can hang for minutes; skip after a short wait so the scan keeps moving. */
const THUMB_MS = 4_000;

async function thumbnail(file: string, kind: AssetKind): Promise<string | undefined> {
  if (kind !== 'IMAGE' && kind !== 'VIDEO') return undefined;
  try {
    // Uses the Windows shell thumbnail provider, so it covers photos, PSDs and videos alike.
    const img = await Promise.race([
      nativeImage.createThumbnailFromPath(file, { width: 320, height: 320 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), THUMB_MS)),
    ]);
    if (!img || img.isEmpty()) return undefined;
    return img.toPNG().toString('base64');
  } catch {
    return undefined;
  }
}

/**
 * Scans the shared library and sends new/changed files (metadata + thumbnail) to the server.
 * The server-issued lease ensures only one PC on the team scans at a time.
 */
export async function scanLibrary(opts: { force?: boolean } = {}): Promise<ScanProgress> {
  if (running) return progress;
  const status = currentStatus().state === 'ok' ? currentStatus() : await checkAccess();
  if (status.state !== 'ok') {
    emit({ state: 'error', message: status.state === 'unavailable' ? status.reason : 'The library location has not been set up yet' });
    return progress;
  }
  const root = status.path;
  running = true;
  control = 'run';
  emit({ state: 'scanning', phase: 'finding', found: 0, indexed: 0, seen: 0, uploaded: 0, message: undefined });

  let leaseToken: string;
  try {
    leaseToken = (await api<{ token: string }>('POST', '/library/lease', { machine: store.get('machineId'), force: opts.force ?? false })).token;
  } catch (err) {
    running = false;
    emit(err instanceof ApiError && err.status === 409 ? { state: 'busy', message: 'Another computer is scanning the library.' } : { state: 'error', message: (err as Error).message });
    return progress;
  }

  try {
    const known = new Map<string, { size: number; mtime: number; thumb: boolean }>();
    for (const [rel, size, mtime, thumb] of await api<[string, number, number, boolean][]>('GET', '/library/index')) {
      // Lower-case keys so Windows path casing drift still counts as "already indexed".
      known.set(rel.toLowerCase(), { size, mtime, thumb });
    }
    const imports = await api<{ relPath: string; kind: 'FOLDER' | 'FILE' }[]>('GET', '/library/imports');
    const excluded = new Set((await api<string[]>('GET', '/library/exclusions')).map((rel) => rel.toLowerCase()));
    const seen: string[] = [];
    let indexed = 0;
    let batch: { relPath: string; size: number; mtime: string; kind: AssetKind; thumbnail?: string }[] = [];
    const renewed = { at: Date.now() };

    if (imports.length === 0) {
      // Finish the lease without wiping existing assets (empty seenPaths is ignored server-side).
      await api('POST', '/library/scan-complete', { leaseToken, seenPaths: [] });
      emit({ state: 'done', phase: 'indexing', found: 0, indexed: 0, seen: 0, uploaded: 0, message: 'Nothing is imported yet. Import folders or files first.' });
      return progress;
    }

    // Pause holds the lease. Cancel releases it and leaves files the walk has not reached alone.
    const hold = async (): Promise<'run' | 'cancel'> => {
      while (control === 'pause') {
        if (Date.now() - renewed.at > 60_000) {
          await api('POST', '/library/lease/renew', { leaseToken });
          renewed.at = Date.now();
        }
        await wait(300);
      }
      return control === 'cancel' ? 'cancel' : 'run';
    };
    const abandon = async () => {
      await api('POST', '/library/scan-complete', { leaseToken, seenPaths: [], releaseOnly: true });
      emit({
        state: 'cancelled',
        message: indexed > 0
          ? `Import cancelled. ${indexed.toLocaleString()} files were indexed. The rest were left as they were.`
          : 'Import cancelled. Nothing new was indexed.',
      });
    };

    const flush = async () => {
      if (batch.length === 0) return;
      const sent = batch.length;
      await api('POST', '/library/assets/batch', { leaseToken, assets: batch });
      indexed += sent;
      batch = [];
      renewed.at = Date.now();
      // Emit with every batch so the grid can refresh while thumbnails are still running.
      emit({ phase: 'indexing', indexed, seen: indexed, uploaded: progress.uploaded + sent });
    };

    async function* selectedFiles(): AsyncGenerator<string> {
      for (const item of imports) {
        const abs = item.relPath ? path.join(root, ...item.relPath.split('/')) : root;
        if (item.kind === 'FILE') yield abs;
        else yield* walk(abs);
      }
    }

    // Count first so the bar has a total. Indexing is the second walk over that list.
    const files: string[] = [];
    for await (const file of selectedFiles()) {
      if (await hold() === 'cancel') {
        await abandon();
        return progress;
      }
      const relPath = toRelPath(root, file);
      if (excluded.has(relPath.toLowerCase())) continue;
      files.push(file);
      if (files.length % 25 === 0) emit({ phase: 'finding', found: files.length, seen: files.length });
    }
    emit({ phase: 'indexing', found: files.length, indexed: 0, seen: 0 });

    for (const file of files) {
      if (await hold() === 'cancel') {
        await flush();
        await abandon();
        return progress;
      }
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        indexed += 1;
        emit({ phase: 'indexing', indexed, seen: indexed });
        continue;
      }
      const relPath = toRelPath(root, file);
      seen.push(relPath);
      const kind = assetKindForPath(relPath);
      const prev = known.get(relPath.toLowerCase());
      const wantsThumb = kind === 'IMAGE' || kind === 'VIDEO';
      const unchanged = prev && prev.size === stat.size && Math.abs(prev.mtime - stat.mtimeMs) < 2000 && (prev.thumb || !wantsThumb);
      if (unchanged) {
        indexed += 1;
        if (indexed % 25 === 0) emit({ phase: 'indexing', indexed, seen: indexed });
      } else {
        batch.push({ relPath, size: stat.size, mtime: stat.mtime.toISOString(), kind, thumbnail: await thumbnail(file, kind) });
        if (batch.length >= BATCH) await flush();
      }
      if (Date.now() - renewed.at > 2 * 60_000) {
        await api('POST', '/library/lease/renew', { leaseToken });
        renewed.at = Date.now();
      }
    }
    await flush();
    await api('POST', '/library/scan-complete', { leaseToken, seenPaths: seen });
    store.set('lastScanAt', new Date().toISOString());
    emit({ state: 'done', phase: 'indexing', found: files.length, indexed: files.length, seen: files.length });
  } catch (err) {
    emit({ state: 'error', message: (err as Error).message });
  } finally {
    running = false;
    control = 'run';
  }
  return progress;
}

let timer: NodeJS.Timeout | null = null;

/** Periodic rescans (network drives don't deliver reliable change events). */
export function startScheduledScans() {
  if (timer) return;
  const tick = async () => {
    const last = store.get('lastScanAt');
    if (last && Date.now() - new Date(last).getTime() < RESCAN_MS) return;
    await scanLibrary().catch(() => undefined);
  };
  setTimeout(tick, 60_000);
  timer = setInterval(tick, 5 * 60_000);
}
