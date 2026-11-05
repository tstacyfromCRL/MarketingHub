/**
 * Snapshots of the local PGlite dev database.
 *
 * PGlite reopens a data folder only after it has closed itself. A hard kill
 * leaves a checkpoint Postgres cannot read (`could not locate a valid checkpoint
 * record`), and that folder never opens again. `dumpDataDir` reads the live
 * database, so the file it writes can be loaded into a new folder even when
 * the original folder is dead. Copying the folder, including Previous Versions,
 * is not a snapshot: those copies are taken while the process is running.
 */
import { vector } from '@electric-sql/pglite-pgvector';
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const DATA_DIR_NAME = '.pglite';
export const BACKUP_DIR_NAME = '.pglite-backups';
export const DEFAULT_BACKUP_INTERVAL_MS = 60_000;
export const DEFAULT_BACKUP_KEEP = 10;

const SNAPSHOT_PREFIX = 'pglite-';
const SNAPSHOT_EXT = '.tgz';

type Dumpable = {
  dumpDataDir(compression?: 'none' | 'gzip' | 'auto'): Promise<Blob>;
};

export function isCheckpointPanic(stderr: string): boolean {
  return /could not locate a valid checkpoint record|invalid resource manager ID in checkpoint record/i.test(stderr);
}

/** UTC stamp that sorts oldest-to-newest and is legal in a Windows file name. */
export function snapshotStamp(now = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return [
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`,
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
    pad(now.getUTCMilliseconds(), 3),
  ].join('-');
}

function isSnapshotName(name: string): boolean {
  return name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(SNAPSHOT_EXT);
}

export async function listSnapshots(backupDir: string): Promise<string[]> {
  if (!existsSync(backupDir)) return [];
  const names = (await readdir(backupDir)).filter(isSnapshotName);
  names.sort();
  return names.map((name) => path.join(backupDir, name));
}

export async function latestSnapshot(backupDir: string): Promise<string | undefined> {
  const snapshots = await listSnapshots(backupDir);
  return snapshots[snapshots.length - 1];
}

/** Drop the oldest snapshots past `keep`. Incomplete `.partial` files are not snapshots. */
export async function pruneSnapshots(backupDir: string, keep: number): Promise<void> {
  const retain = Math.max(1, keep);
  const snapshots = await listSnapshots(backupDir);
  const extra = snapshots.slice(0, Math.max(0, snapshots.length - retain));
  await Promise.all(extra.map((file) => rm(file, { force: true })));
}

/**
 * Write a complete snapshot, then publish it by rename so a crash mid-write
 * cannot leave a half file as the newest snapshot.
 */
export async function writeSnapshot(db: Dumpable, backupDir: string, keep = DEFAULT_BACKUP_KEEP): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  const dump = await db.dumpDataDir('gzip');
  const bytes = Buffer.from(await dump.arrayBuffer());
  if (bytes.length === 0) throw new Error('Dev database snapshot was empty and was not saved.');
  const finalName = `${SNAPSHOT_PREFIX}${snapshotStamp()}${SNAPSHOT_EXT}`;
  const partial = path.join(backupDir, `.${finalName}.partial`);
  const dest = path.join(backupDir, finalName);
  await writeFile(partial, bytes);
  await rename(partial, dest);
  await pruneSnapshots(backupDir, keep);
  return dest;
}

async function createDatabase(dataDir: string, loadDataDir?: Blob) {
  return PGlite.create(dataDir, {
    extensions: { vector },
    ...(loadDataDir ? { loadDataDir } : {}),
  });
}

export async function openFromSnapshot(snapshotPath: string, dataDir: string) {
  const bytes = await readFile(snapshotPath);
  return createDatabase(dataDir, new Blob([bytes]));
}

export async function moveAside(dataDir: string): Promise<string | undefined> {
  if (!existsSync(dataDir)) return undefined;
  const dest = `${dataDir}-unopenable-${snapshotStamp()}`;
  try {
    await rename(dataDir, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      throw new Error('The dev database is still using that folder. Stop it with Ctrl+C, then run pnpm db:restore.');
    }
    throw err;
  }
  return dest;
}

export function tcpPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * Load the newest snapshot into `dataDir`. The previous folder is renamed aside,
 * not deleted. Refuses while something is listening on the dev database port,
 * because that process is the owner of the folder.
 */
export async function restoreLatest(options: {
  dataDir: string;
  backupDir: string;
  portBusy: () => Promise<boolean>;
}): Promise<{ snapshot: string; movedAside?: string }> {
  if (await options.portBusy()) {
    throw new Error('The dev database is still running. Stop it with Ctrl+C, then run pnpm db:restore.');
  }
  const snapshot = await latestSnapshot(options.backupDir);
  if (!snapshot) {
    throw new Error(`No dev database snapshot in ${options.backupDir}. There is nothing to restore.`);
  }
  const movedAside = await moveAside(options.dataDir);
  try {
    const db = await openFromSnapshot(snapshot, options.dataDir);
    // Close before returning so the new folder has a checkpoint of its own.
    await db.close();
  } catch (err) {
    const kept = movedAside ? ` The previous folder is still at ${movedAside}.` : '';
    throw new Error(`Could not load snapshot ${snapshot}.${kept}`, { cause: err });
  }
  return { snapshot, ...(movedAside ? { movedAside } : {}) };
}

async function capturingStderr<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // Forward every argument. Postgres logs the checkpoint panic on stderr, and
  // dropping the completion callback here can stall the startup that emits it.
  process.stderr.write = ((...args: unknown[]) => {
    const chunk = args[0];
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    return (original as (...forwarded: unknown[]) => boolean)(...args);
  }) as typeof process.stderr.write;
  try {
    return { value: await fn(), stderr: chunks.join('') };
  } catch (error) {
    return { error, stderr: chunks.join('') };
  } finally {
    process.stderr.write = original;
  }
}

/**
 * Open the dev database. When the folder dies with an invalid checkpoint and a
 * snapshot exists, load that snapshot into a new folder and keep the broken one.
 * One attempt only: a second failure means this process should exit and
 * `pnpm db:restore` should be run on its own.
 */
export async function openDevDatabase(dataDir: string, backupDir: string) {
  const first = await capturingStderr(() => createDatabase(dataDir));
  if (first.value) return { db: first.value, restoredFrom: undefined as string | undefined };
  if (!isCheckpointPanic(first.stderr)) throw first.error;
  const snapshot = await latestSnapshot(backupDir);
  if (!snapshot) {
    throw new Error(
      `The dev database folder will not open (invalid checkpoint), and there is no snapshot in ${backupDir}. The broken folder was left in place.`,
      { cause: first.error },
    );
  }
  console.error(`The dev database folder will not open (invalid checkpoint). Restoring ${snapshot}.`);
  const movedAside = await moveAside(dataDir);
  if (movedAside) console.error(`Kept the broken folder at ${movedAside}.`);
  const second = await capturingStderr(() => openFromSnapshot(snapshot, dataDir));
  if (!second.value) {
    throw new Error(
      `Could not restore ${snapshot} in this process. Run pnpm db:restore once this process has exited.`,
      { cause: second.error },
    );
  }
  return { db: second.value, restoredFrom: snapshot };
}

/**
 * Snapshot on a timer while the database is running. A hard kill never reaches
 * the shutdown snapshot, so the timer is what limits how much company data can be lost.
 * Overlapping dumps are skipped; the caller can await the one in flight.
 */
export function startBackupLoop(db: Dumpable, backupDir: string, intervalMs = DEFAULT_BACKUP_INTERVAL_MS): {
  stop: () => void;
  snapshotNow: () => Promise<string | undefined>;
} {
  if (intervalMs <= 0) {
    return { stop() {}, snapshotNow: async () => undefined };
  }
  let current: Promise<string | undefined> | null = null;
  const snapshotNow = (): Promise<string | undefined> => {
    if (current) return current;
    current = (async () => {
      try {
        const file = await writeSnapshot(db, backupDir);
        console.log(`Dev database snapshot: ${file}`);
        return file;
      } catch (err) {
        console.error(`Dev database snapshot failed: ${err instanceof Error ? err.message : err}`);
        return undefined;
      } finally {
        current = null;
      }
    })();
    return current;
  };
  const first = setTimeout(() => void snapshotNow(), Math.min(5_000, intervalMs));
  const timer = setInterval(() => void snapshotNow(), intervalMs);
  first.unref();
  timer.unref();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
    snapshotNow,
  };
}
