import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

/** Writes a folder as a zip (stored, not compressed) so a pack can be downloaded. */
export async function zipDirectory(dir: string): Promise<Buffer> {
  const files = await walk(dir);
  const entries: { name: string; data: Buffer }[] = [];
  for (const file of files) {
    entries.push({ name: path.relative(dir, file).replace(/\\/g, '/'), data: await readFile(file) });
  }
  return zipEntries(entries);
}

/**
 * Zip of named files. Names may include folders (`Post title/graphic.png`) so a download
 * can unpack as a folder instead of loose files. Stored, not compressed.
 */
export function zipEntries(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const cleaned = entry.name.replace(/\\/g, '/');
    if (!cleaned || cleaned.startsWith('/') || cleaned.split('/').includes('..')) {
      throw new Error(`Unsafe path in zip: ${entry.name}`);
    }
    const name = Buffer.from(cleaned);
    const data = entry.data;
    const local = localHeader(name, data);
    locals.push(local, data);
    centrals.push(centralHeader(name, data, offset));
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

/** Unpacks a zip into a directory. Rejects paths that leave that directory. */
export async function unzipToDirectory(buffer: Buffer, dest: string): Promise<void> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  await mkdir(dest, { recursive: true });
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Zip directory is damaged');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localAt = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const safe = safeJoin(dest, name);
    const localNameLen = buffer.readUInt16LE(localAt + 26);
    const localExtraLen = buffer.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + compressed);
    const bytes = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!bytes) throw new Error(`Unsupported zip method ${method} for ${name}`);
    await mkdir(path.dirname(safe), { recursive: true });
    await writeFile(safe, bytes);
  }
}

function safeJoin(dest: string, name: string): string {
  const cleaned = name.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || cleaned.split('/').includes('..')) throw new Error(`Unsafe path in zip: ${name}`);
  const root = path.resolve(dest);
  const full = path.resolve(dest, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Unsafe path in zip: ${name}`);
  return full;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('That file is not a zip archive');
}

function localHeader(name: Buffer, data: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

function centralHeader(name: Buffer, data: Buffer, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
