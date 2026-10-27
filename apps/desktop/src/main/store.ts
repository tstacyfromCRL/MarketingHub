import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Per-user, per-machine settings in %APPDATA%\Mantis\settings.json. */
interface Settings {
  serverUrl: string;
  machineId: string;
  /** safeStorage-encrypted session token, base64. */
  tokenEnc: string | null;
  lastScanAt: string | null;
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

let cache: Settings | null = null;

function load(): Settings {
  if (cache) return cache;
  let data: Partial<Settings> = {};
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    // First run.
  }
  cache = {
    serverUrl: data.serverUrl ?? 'http://localhost:4000',
    machineId: data.machineId ?? `${process.env.COMPUTERNAME ?? 'PC'}-${crypto.randomBytes(3).toString('hex')}`,
    tokenEnc: data.tokenEnc ?? null,
    lastScanAt: data.lastScanAt ?? null,
  };
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
}

export const store = {
  get<K extends keyof Settings>(key: K): Settings[K] {
    return load()[key];
  },
  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    load()[key] = value;
    save();
  },
  getToken(): string | null {
    const enc = load().tokenEnc;
    if (!enc) return null;
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : null;
    } catch {
      return null;
    }
  },
  setToken(token: string | null) {
    if (!token || !safeStorage.isEncryptionAvailable()) {
      store.set('tokenEnc', null);
      return;
    }
    store.set('tokenEnc', safeStorage.encryptString(token).toString('base64'));
  },
};
