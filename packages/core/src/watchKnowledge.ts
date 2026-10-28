import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mh/db';
import { config } from './config';
import { extractText } from './extractText';
import { enqueue } from './queue';

/** Indexes files dropped in KNOWLEDGE_WATCH_DIR for the default org. Missing files are removed. */
export async function watchKnowledgeDir(orgId: string): Promise<void> {
  const root = config.KNOWLEDGE_WATCH_DIR;
  if (!root) return;
  const files = await walk(root);
  const seen = new Set<string>();
  for (const file of files) {
    if (!/\.(md|txt|pdf|docx)$/i.test(file)) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const externalKey = `watch:${rel}`;
    seen.add(externalKey);
    const bytes = await readFile(file);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.source.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
    if (existing?.contentHash === hash) continue;
    const text = await extractText(bytes, file).catch((err: Error) => err.message);
    const data = { title: path.basename(file), content: text, kind: 'DOCUMENT' as const, status: 'OK' as const, origin: 'watch', contentHash: hash };
    const row = existing
      ? await prisma.source.update({ where: { id: existing.id }, data })
      : await prisma.source.create({ data: { organizationId: orgId, externalKey, ...data } });
    await enqueue('embed-knowledge', { orgId, sourceType: 'SOURCE', sourceId: row.id });
  }
  const stale = await prisma.source.findMany({ where: { organizationId: orgId, origin: 'watch' } });
  for (const row of stale) {
    if (row.externalKey && seen.has(row.externalKey)) continue;
    await prisma.source.delete({ where: { id: row.id } });
    await enqueue('embed-knowledge', { orgId, sourceType: 'SOURCE', sourceId: row.id });
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return [];
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
