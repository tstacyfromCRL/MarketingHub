import { dialog, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LIBRARY_NAME, libraryNotFoundMessage, resolveLibraryPath, toUncPath, type DriveMapping, type LibraryLocation, type LibraryStatus,
} from '@mh/shared';
import { api, ApiError, type Me } from './api';
import { store } from './store';

interface TeamLibrary {
  library: { id: string; name: string } | null;
  location: LibraryLocation | null;
}

let lastStatus: LibraryStatus = { state: 'unset', name: DEFAULT_LIBRARY_NAME };
export const currentStatus = () => lastStatus;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (_err, stdout) => resolve(stdout ?? ''));
  });
}

/**
 * Network drives mapped for this Windows user. Reads the registry (persistent mappings) and `net use`
 * (session mappings); both answer instantly, unlike WMI, which can hang on a reconnecting drive.
 */
export async function driveMappings(): Promise<DriveMapping[]> {
  if (process.platform !== 'win32') return [];
  const [reg, net] = await Promise.all([run('reg', ['query', 'HKCU\\Network', '/s', '/v', 'RemotePath']), run('net', ['use'])]);
  const found = new Map<string, string>();
  let letter: string | null = null;
  for (const line of reg.split(/\r?\n/)) {
    const key = /\\Network\\([A-Za-z])\s*$/.exec(line);
    if (key) letter = key[1].toUpperCase();
    const val = /RemotePath\s+REG_\w+\s+(\\\\\S.*?)\s*$/.exec(line);
    if (letter && val) found.set(letter, val[1]);
  }
  for (const m of net.matchAll(/\b([A-Za-z]):\s+(\\\\[^\s]+)/g)) {
    if (!found.has(m[1].toUpperCase())) found.set(m[1].toUpperCase(), m[2]);
  }
  return [...found].map(([l, remote]) => ({ letter: l, remote }));
}

/** Whether the folder can be listed, giving up after a few seconds on unresponsive network drives. */
async function readable(dir: string): Promise<boolean> {
  const check = (async () => {
    await fs.access(dir, FS.R_OK);
    const d = await fs.opendir(dir);
    await d.close();
    return true;
  })().catch(() => false);
  return Promise.race([check, new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
}

async function reportConfigured(configured: boolean) {
  await api('PUT', '/me/library', { configured }).catch(() => undefined);
}

function statusFor(team: TeamLibrary, resolved: string | null, ok: boolean): LibraryStatus {
  const name = team.library?.name ?? DEFAULT_LIBRARY_NAME;
  const loc = team.location!;
  if (resolved && ok) return { state: 'ok', name, path: resolved, rootPath: loc.rootPath, uncPath: loc.uncPath };
  return { state: 'unavailable', name, rootPath: loc.rootPath, uncPath: loc.uncPath, reason: libraryNotFoundMessage(name) };
}

/** Finds the admin-chosen library drive on this PC. Runs at startup, on window focus, and on "Re-check". */
export async function checkAccess(): Promise<LibraryStatus> {
  let team: TeamLibrary;
  try {
    team = await api<TeamLibrary>('GET', '/library');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return lastStatus;
    const name = lastStatus.name;
    lastStatus = { state: 'unavailable', name, rootPath: null, uncPath: null, reason: `Can't reach the Marketing Hub server: ${(err as Error).message}` };
    return lastStatus;
  }
  if (!team.location) {
    lastStatus = { state: 'unset', name: team.library?.name ?? DEFAULT_LIBRARY_NAME };
    return lastStatus;
  }
  const resolved = resolveLibraryPath(team.location, await driveMappings());
  lastStatus = statusFor(team, resolved, resolved ? await readable(resolved) : false);
  await reportConfigured(lastStatus.state === 'ok');
  return lastStatus;
}

/** Admin only: "Select Library Location" picks the network drive folder the whole team uses. */
export async function selectLocation(win: BrowserWindow | null, name?: string): Promise<LibraryStatus & { cancelled?: boolean; error?: string }> {
  const me = await api<Me>('GET', '/me');
  if (me.role !== 'ADMIN') return { ...lastStatus, error: 'Only an admin can choose the library location.' };

  const current = lastStatus.state === 'ok' ? lastStatus.path : undefined;
  const opts = {
    title: 'Select Library Location',
    buttonLabel: 'Select Folder',
    properties: ['openDirectory'] as ('openDirectory')[],
    defaultPath: current,
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || !result.filePaths[0]) return { ...lastStatus, cancelled: true };

  const rootPath = result.filePaths[0];
  if (!(await readable(rootPath))) return { ...lastStatus, error: `Can't open ${rootPath}. Check that the drive is connected and you have access.` };
  const uncPath = toUncPath(rootPath, await driveMappings());
  await api('PUT', '/library', { name: name?.trim() || lastStatus.name || DEFAULT_LIBRARY_NAME, rootPath, uncPath });
  return checkAccess();
}

export function getLocation() {
  return { status: lastStatus, machine: store.get('machineId') };
}

/** Absolute path for an asset, refusing anything that escapes the library root. */
export function resolveAsset(relPath: string): string {
  if (lastStatus.state !== 'ok') throw new ApiError(400, 'The library location is not available');
  const root = lastStatus.path;
  const abs = path.resolve(root, ...relPath.split('/'));
  if (!abs.toLowerCase().startsWith(path.resolve(root).toLowerCase())) throw new ApiError(400, 'Invalid asset path');
  return abs;
}
