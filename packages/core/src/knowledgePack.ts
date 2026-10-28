import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma, type Prisma } from '@mh/db';
import {
  packAccomplishmentSchema,
  packBrandSchema,
  packClaimSchema,
  packConfidentialSchema,
  packDocumentMetaSchema,
  packExampleFrontmatterSchema,
  packManifestSchema,
  packPlaybookSchema,
  packProductSchema,
  packSourceSchema,
  type PackBrand,
} from '@mh/shared';
import { z } from 'zod';
import { extractText } from './extractText';
import { contentHash } from './hash';
import { enqueue } from './queue';
import { newStorageKey, storage } from './storage';

export interface PackCounts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  warnings: string[];
  details: { key: string; action: 'created' | 'updated' | 'unchanged' | 'removed' }[];
}

export interface PackReport {
  brand: PackCounts;
  playbooks: PackCounts;
  products: PackCounts;
  claims: PackCounts;
  accomplishments: PackCounts;
  sources: PackCounts;
  examples: PackCounts;
  documents: PackCounts;
  confidential: PackCounts;
}

export class PackValidationError extends Error {
  constructor(public issues: { file: string; path: string; message: string }[]) {
    super(issues.map((issue) => `${issue.file} ${issue.path}: ${issue.message}`).join('\n') || 'Knowledge pack is invalid');
    this.name = 'PackValidationError';
  }
}

const empty = (): PackCounts => ({ created: 0, updated: 0, unchanged: 0, removed: 0, warnings: [], details: [] });

function note(row: PackCounts, key: string, action: PackCounts['details'][number]['action']) {
  row[action] += 1;
  row.details.push({ key, action });
}

interface LoadedPack {
  brand: PackBrand;
  playbooks: z.infer<typeof packPlaybookSchema>[];
  products: z.infer<typeof packProductSchema>[];
  claims: z.infer<typeof packClaimSchema>[];
  accomplishments: z.infer<typeof packAccomplishmentSchema>[];
  sources: z.infer<typeof packSourceSchema>[];
  confidential: z.infer<typeof packConfidentialSchema>[];
  examples: { key: string; platform: string; pillar?: string; contentType?: string; body: string }[];
  documents: { key: string; title: string; sensitivity: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED'; text: string; filename: string; bytes: Buffer }[];
}

/** Reads and validates a pack. Throws before any database write when a file is wrong. */
export async function loadKnowledgePack(dir: string): Promise<LoadedPack> {
  const issues: { file: string; path: string; message: string }[] = [];
  const readJson = async <S extends z.ZodTypeAny>(file: string, schema: S, fallback?: z.output<S>): Promise<z.output<S>> => {
    const full = path.join(dir, file);
    try {
      const raw = await readFile(full, 'utf8');
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) issues.push({ file, path: issue.path.join('.') || '(root)', message: issue.message });
        return fallback as z.output<S>;
      }
      return parsed.data;
    } catch (err) {
      if (fallback !== undefined && (err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      issues.push({ file, path: '(file)', message: (err as Error).message });
      return fallback as z.output<S>;
    }
  };

  const manifest = await readJson('manifest.json', packManifestSchema);
  void manifest;
  const brand = await readJson('brand.json', packBrandSchema);
  const playbooks = await readJsonDir(dir, 'playbooks', packPlaybookSchema, issues);
  const products = await readJson('products.json', z.array(packProductSchema), []);
  const claims = await readJson('claims.json', z.array(packClaimSchema), []);
  const accomplishments = await readJson('accomplishments.json', z.array(packAccomplishmentSchema), []);
  const sources = await readJson('sources.json', z.array(packSourceSchema), []);
  const confidential = await readJson('confidential.json', z.array(packConfidentialSchema), []);
  const examples = await readExamples(dir, issues);
  const documents = await readDocuments(dir, issues);
  if (issues.length) throw new PackValidationError(issues);
  return { brand, playbooks, products, claims, accomplishments, sources, confidential, examples, documents };
}

async function readJsonDir<S extends z.ZodTypeAny>(dir: string, folder: string, schema: S, issues: { file: string; path: string; message: string }[]): Promise<z.output<S>[]> {
  const full = path.join(dir, folder);
  let names: string[] = [];
  try {
    names = (await readdir(full)).filter((name) => name.endsWith('.json'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const rows: z.output<S>[] = [];
  for (const name of names) {
    const file = `${folder}/${name}`;
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(path.join(full, name), 'utf8')));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) issues.push({ file, path: issue.path.join('.') || '(root)', message: issue.message });
      } else rows.push(parsed.data);
    } catch (err) {
      issues.push({ file, path: '(file)', message: (err as Error).message });
    }
  }
  return rows;
}

export function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(end + 4).replace(/^\n/, '') };
}

async function readExamples(dir: string, issues: { file: string; path: string; message: string }[]) {
  const folder = path.join(dir, 'examples');
  let names: string[] = [];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith('.md'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const name of names) {
    const file = `examples/${name}`;
    const { data, body } = splitFrontmatter(await readFile(path.join(folder, name), 'utf8'));
    const parsed = packExampleFrontmatterSchema.safeParse(data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) issues.push({ file, path: issue.path.join('.') || '(root)', message: issue.message });
      continue;
    }
    rows.push({ ...parsed.data, body: body.trim() });
  }
  return rows;
}

async function readDocuments(dir: string, issues: { file: string; path: string; message: string }[]) {
  const folder = path.join(dir, 'documents');
  let names: string[] = [];
  try {
    names = await readdir(folder);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const name of names) {
    if (name.endsWith('.meta.json') || name === 'README.md') continue;
    if (!/\.(md|txt|pdf|docx)$/i.test(name)) continue;
    const file = `documents/${name}`;
    const bytes = await readFile(path.join(folder, name));
    let meta: z.infer<typeof packDocumentMetaSchema> = {};
    const sidecar = path.join(folder, `${name}.meta.json`);
    try {
      const parsed = packDocumentMetaSchema.safeParse(JSON.parse(await readFile(sidecar, 'utf8')));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) issues.push({ file: `${file}.meta.json`, path: issue.path.join('.') || '(root)', message: issue.message });
        continue;
      }
      meta = parsed.data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') issues.push({ file, path: '(meta)', message: (err as Error).message });
    }
    let text = '';
    let frontKey = meta.key;
    let sensitivity = meta.sensitivity ?? 'PUBLIC';
    if (/\.md$/i.test(name)) {
      const split = splitFrontmatter(bytes.toString('utf8'));
      text = split.body.trim();
      if (split.data.key) frontKey = split.data.key;
      if (split.data.sensitivity === 'PUBLIC' || split.data.sensitivity === 'INTERNAL' || split.data.sensitivity === 'RESTRICTED') sensitivity = split.data.sensitivity;
    } else {
      try {
        text = await extractText(bytes, name);
      } catch (err) {
        issues.push({ file, path: '(text)', message: (err as Error).message });
        continue;
      }
    }
    rows.push({ key: frontKey || name.replace(/\.[^.]+$/, ''), title: meta.title || name, sensitivity, text, filename: name, bytes });
  }
  return rows;
}

const packKey = (key: string) => `pack:${key}`;

/**
 * Fills one org from a knowledge pack. Validation failures change nothing.
 * prune only retires rows this pack previously created.
 */
export async function importKnowledgePack(orgId: string, dir: string, opts: { dryRun?: boolean; prune?: boolean } = {}): Promise<PackReport> {
  const pack = await loadKnowledgePack(dir);
  const report: PackReport = {
    brand: empty(), playbooks: empty(), products: empty(), claims: empty(), accomplishments: empty(),
    sources: empty(), examples: empty(), documents: empty(), confidential: empty(),
  };
  const seen = {
    playbooks: new Set<string>(), products: new Set<string>(), claims: new Set<string>(), accomplishments: new Set<string>(),
    sources: new Set<string>(), confidential: new Set<string>(),
  };
  const embeds: { sourceType: 'BRAND' | 'PRODUCT' | 'ACCOMPLISHMENT' | 'SOURCE' | 'CLAIM'; sourceId: string }[] = [];
  const scrapes: string[] = [];
  const dry = Boolean(opts.dryRun);

  const run = async (tx: Prisma.TransactionClient) => {
    const brandHash = contentHash(pack.brand);
    const brand = await tx.brandProfile.findUnique({ where: { organizationId: orgId } });
    const brandData = {
      companyName: pack.brand.companyName,
      summary: pack.brand.summary,
      website: pack.brand.website,
      tagline: pack.brand.tagline,
      mission: pack.brand.mission,
      voice: pack.brand.voice,
      visualIdentity: pack.brand.visualIdentity,
      audience: pack.brand.audience,
      colors: pack.brand.colors,
      fonts: pack.brand.fonts,
      dos: pack.brand.dos,
      donts: pack.brand.donts,
    };
    if (!brand) {
      note(report.brand, 'brand', 'created');
      if (!dry) {
        const created = await tx.brandProfile.create({ data: { organizationId: orgId, ...brandData } });
        embeds.push({ sourceType: 'BRAND', sourceId: created.id });
      }
    } else if (contentHash({
      companyName: brand.companyName, summary: brand.summary, website: brand.website, tagline: brand.tagline,
      mission: brand.mission, voice: brand.voice, visualIdentity: brand.visualIdentity, audience: brand.audience,
      colors: brand.colors, fonts: brand.fonts, dos: brand.dos, donts: brand.donts,
    }) === brandHash) {
      note(report.brand, 'brand', 'unchanged');
    } else {
      note(report.brand, 'brand', 'updated');
      if (!dry) {
        await tx.brandProfile.update({ where: { id: brand.id }, data: brandData });
        embeds.push({ sourceType: 'BRAND', sourceId: brand.id });
      }
    }

    for (const row of pack.playbooks) {
      const externalKey = packKey(row.key);
      seen.playbooks.add(externalKey);
      const hash = contentHash(row);
      const existing = await tx.promptTemplate.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      const data = {
        name: row.name, body: row.body, platform: row.platform ?? null, contentType: row.contentType ?? null, pillar: row.pillar ?? null,
        hashtagMin: row.hashtagMin ?? null, hashtagMax: row.hashtagMax ?? null, maxChars: row.maxChars ?? null, origin: 'pack', contentHash: hash, active: true,
      };
      if (!existing) {
        note(report.playbooks, row.key, 'created');
        if (!dry) await tx.promptTemplate.create({ data: { organizationId: orgId, externalKey, ...data } });
      } else if (existing.contentHash === hash) note(report.playbooks, row.key, 'unchanged');
      else {
        note(report.playbooks, row.key, 'updated');
        if (!dry) await tx.promptTemplate.update({ where: { id: existing.id }, data: { ...data, version: existing.version + 1 } });
      }
    }

    const productIds = new Map<string, string>();
    for (const row of pack.products) {
      const externalKey = packKey(row.key);
      seen.products.add(externalKey);
      const hash = contentHash(row);
      const existing = await tx.product.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      const data = {
        name: row.name, sku: row.sku ?? '', description: row.description, positioning: row.description, features: row.features,
        packFeatures: row.features, url: row.url ?? '', pricing: row.pricing ?? '', links: row.links, packLinks: row.links,
        sensitivity: row.sensitivity ?? 'PUBLIC', origin: 'pack', contentHash: hash, active: true,
      };
      if (!existing) {
        note(report.products, row.key, 'created');
        if (!dry) {
          const created = await tx.product.create({ data: { organizationId: orgId, externalKey, ...data } });
          productIds.set(row.key, created.id);
          embeds.push({ sourceType: 'PRODUCT', sourceId: created.id });
        }
      } else {
        productIds.set(row.key, existing.id);
        if (existing.contentHash === hash) note(report.products, row.key, 'unchanged');
        else {
          note(report.products, row.key, 'updated');
          if (!dry) {
            // A connector that shares this SKU keeps name, price, URL and description.
            const merged = existing.connectorKey
              ? { ...data, name: existing.name, sku: existing.sku || data.sku, description: existing.description, url: existing.url, pricing: existing.pricing }
              : data;
            await tx.product.update({ where: { id: existing.id }, data: merged });
            embeds.push({ sourceType: 'PRODUCT', sourceId: existing.id });
          }
        }
      }
    }

    for (const row of pack.claims) {
      const externalKey = packKey(row.key);
      seen.claims.add(externalKey);
      const hash = contentHash(row);
      const existing = await tx.claim.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      const data = {
        text: row.text, sourceUrl: row.sourceUrl ?? '', asOf: row.asOf ? new Date(row.asOf) : null, expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        productIds: row.productKeys.map((key) => productIds.get(key)).filter((id): id is string => Boolean(id)),
        sensitivity: row.sensitivity ?? 'PUBLIC', origin: 'pack', contentHash: hash, status: 'APPROVED',
      };
      if (!existing) {
        note(report.claims, row.key, 'created');
        if (!dry) {
          const created = await tx.claim.create({ data: { organizationId: orgId, externalKey, ...data } });
          embeds.push({ sourceType: 'CLAIM', sourceId: created.id });
        }
      } else if (existing.contentHash === hash) note(report.claims, row.key, 'unchanged');
      else {
        note(report.claims, row.key, 'updated');
        if (!dry) {
          await tx.claim.update({ where: { id: existing.id }, data });
          embeds.push({ sourceType: 'CLAIM', sourceId: existing.id });
        }
      }
    }

    for (const row of pack.accomplishments) {
      const externalKey = packKey(row.key);
      seen.accomplishments.add(externalKey);
      const hash = contentHash(row);
      const existing = await tx.accomplishment.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      const data = {
        title: row.title, description: row.description, date: row.date ? new Date(row.date) : null,
        sensitivity: row.sensitivity ?? 'PUBLIC', origin: 'pack', contentHash: hash,
      };
      if (!existing) {
        note(report.accomplishments, row.key, 'created');
        if (!dry) {
          const created = await tx.accomplishment.create({ data: { organizationId: orgId, externalKey, ...data } });
          embeds.push({ sourceType: 'ACCOMPLISHMENT', sourceId: created.id });
        }
      } else if (existing.contentHash === hash) note(report.accomplishments, row.key, 'unchanged');
      else {
        note(report.accomplishments, row.key, 'updated');
        if (!dry) {
          await tx.accomplishment.update({ where: { id: existing.id }, data });
          embeds.push({ sourceType: 'ACCOMPLISHMENT', sourceId: existing.id });
        }
      }
    }

    for (const row of [...pack.sources.map((source) => ({ ...source, kind: source.kind, sample: false })), ...pack.examples.map((example) => ({ key: example.key, url: undefined as string | undefined, kind: 'SAMPLE_POST' as const, recrawlDays: undefined, sensitivity: 'PUBLIC' as const, sample: true, example }))] ) {
      const externalKey = packKey(row.key);
      seen.sources.add(externalKey);
      const example = 'example' in row ? row.example : undefined;
      const hash = contentHash(example ?? row);
      const existing = await tx.source.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      const data = example
        ? { kind: 'SAMPLE_POST' as const, title: example.key, content: example.body, platform: example.platform, status: 'OK' as const, sensitivity: 'PUBLIC' as const, origin: 'pack', contentHash: hash }
        : { url: row.url, kind: row.kind, title: row.url ?? row.key, recrawlDays: row.recrawlDays ?? null, sensitivity: row.sensitivity ?? 'PUBLIC', origin: 'pack', contentHash: hash, status: 'PENDING' as const };
      const bucket = example ? report.examples : report.sources;
      if (!existing) {
        note(bucket, row.key, 'created');
        if (!dry) {
          const created = await tx.source.create({ data: { organizationId: orgId, externalKey, ...data } });
          if (example) embeds.push({ sourceType: 'SOURCE', sourceId: created.id });
          else scrapes.push(created.id);
        }
      } else if (existing.contentHash === hash) note(bucket, row.key, 'unchanged');
      else {
        note(bucket, row.key, 'updated');
        if (!dry) {
          await tx.source.update({ where: { id: existing.id }, data });
          if (example) embeds.push({ sourceType: 'SOURCE', sourceId: existing.id });
          else scrapes.push(existing.id);
        }
      }
    }

    for (const doc of pack.documents) {
      const externalKey = packKey(doc.key);
      seen.sources.add(externalKey);
      const hash = contentHash({ key: doc.key, text: doc.text, sensitivity: doc.sensitivity });
      const existing = await tx.source.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
      if (existing?.contentHash === hash) {
        note(report.documents, doc.key, 'unchanged');
        continue;
      }
      let storageKey: string | undefined;
      if (!dry && doc.sensitivity !== 'RESTRICTED') {
        const ext = doc.filename.split('.').pop() ?? 'bin';
        storageKey = newStorageKey(`orgs/${orgId}/documents`, ext);
        await storage.put(storageKey, doc.bytes, 'application/octet-stream');
      }
      const data = {
        kind: 'DOCUMENT' as const, title: doc.title, content: doc.text, status: 'OK' as const, sensitivity: doc.sensitivity,
        origin: 'pack', contentHash: hash, url: storageKey ? `storage:${storageKey}` : null,
      };
      if (!existing) {
        note(report.documents, doc.key, 'created');
        if (!dry) {
          const created = await tx.source.create({ data: { organizationId: orgId, externalKey, ...data } });
          embeds.push({ sourceType: 'SOURCE', sourceId: created.id });
        }
      } else {
        note(report.documents, doc.key, 'updated');
        if (!dry) {
          await tx.source.update({ where: { id: existing.id }, data });
          embeds.push({ sourceType: 'SOURCE', sourceId: existing.id });
        }
      }
    }

    for (const row of pack.confidential) {
      seen.confidential.add(row.term);
      const existing = await tx.confidentialTerm.findUnique({ where: { organizationId_term: { organizationId: orgId, term: row.term } } });
      const data = { aliases: row.aliases, note: row.note ?? '', origin: 'pack' };
      if (!existing) {
        note(report.confidential, row.term, 'created');
        if (!dry) await tx.confidentialTerm.create({ data: { organizationId: orgId, term: row.term, ...data } });
      } else if (existing.note === data.note && existing.aliases.join('|') === data.aliases.join('|')) note(report.confidential, row.term, 'unchanged');
      else {
        note(report.confidential, row.term, 'updated');
        if (!dry) await tx.confidentialTerm.update({ where: { id: existing.id }, data });
      }
    }

    if (opts.prune) {
      await prune(tx, orgId, 'promptTemplate', seen.playbooks, report.playbooks, dry);
      await prune(tx, orgId, 'product', seen.products, report.products, dry);
      await prune(tx, orgId, 'claim', seen.claims, report.claims, dry);
      await prune(tx, orgId, 'accomplishment', seen.accomplishments, report.accomplishments, dry);
      await prune(tx, orgId, 'source', seen.sources, report.sources, dry);
      const terms = await tx.confidentialTerm.findMany({ where: { organizationId: orgId, origin: 'pack' } });
      for (const term of terms) {
        if (seen.confidential.has(term.term)) continue;
        note(report.confidential, term.term, 'removed');
        if (!dry) await tx.confidentialTerm.delete({ where: { id: term.id } });
      }
    }
  };

  if (dry) await run(prisma as unknown as Prisma.TransactionClient);
  else await prisma.$transaction(async (tx) => run(tx), { timeout: 60_000 });

  if (!dry) {
    try {
      for (const item of embeds) await enqueue('embed-knowledge', { orgId, ...item });
      for (const sourceId of scrapes) await enqueue('scrape-source', { orgId, sourceId });
    } catch (err) {
      report.brand.warnings.push(`Saved the pack, but follow-up jobs were not queued: ${(err as Error).message}`);
    }
  }
  return report;
}

async function prune(
  tx: Prisma.TransactionClient,
  orgId: string,
  model: 'promptTemplate' | 'product' | 'claim' | 'accomplishment' | 'source',
  seen: Set<string>,
  row: PackCounts,
  dry: boolean,
) {
  const rows = await (tx[model] as unknown as { findMany: (q: unknown) => Promise<{ id: string; externalKey: string | null }[]> }).findMany({
    where: { organizationId: orgId, origin: 'pack' },
  });
  for (const item of rows) {
    if (!item.externalKey || seen.has(item.externalKey)) continue;
    note(row, item.externalKey.replace(/^pack:/, ''), 'removed');
    if (!dry) {
      if (model === 'promptTemplate') await tx.promptTemplate.update({ where: { id: item.id }, data: { active: false } });
      else {
        await tx.knowledgeChunk.deleteMany({ where: { sourceId: item.id } });
        await (tx[model] as unknown as { delete: (q: unknown) => Promise<unknown> }).delete({ where: { id: item.id } });
      }
    }
  }
}

/** Writes the org's knowledge back out in the pack layout, so a pack can round-trip. */
export async function exportKnowledgePack(orgId: string, dir: string): Promise<void> {
  await mkdir(path.join(dir, 'playbooks'), { recursive: true });
  await mkdir(path.join(dir, 'examples'), { recursive: true });
  await mkdir(path.join(dir, 'documents'), { recursive: true });
  const brand = await prisma.brandProfile.findUnique({ where: { organizationId: orgId } });
  const keyOf = (externalKey: string | null, fallback: string) => (externalKey ?? fallback).replace(/^(pack|seed|connector):/, '').replace(/[:/]/g, '-');
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: brand?.companyName || 'Knowledge pack', updatedAt: new Date().toISOString() }, null, 2));
  await writeFile(path.join(dir, 'brand.json'), JSON.stringify({
    companyName: brand?.companyName ?? '', summary: brand?.summary ?? '', tagline: brand?.tagline ?? '', mission: brand?.mission ?? '',
    audience: brand?.audience ?? '', voice: brand?.voice ?? '', visualIdentity: brand?.visualIdentity ?? '', dos: brand?.dos ?? [], donts: brand?.donts ?? [],
    colors: brand?.colors ?? [], fonts: brand?.fonts ?? [], website: brand?.website ?? '',
  }, null, 2));
  const playbooks = await prisma.promptTemplate.findMany({ where: { organizationId: orgId, active: true, origin: { not: 'seed' } } });
  for (const row of playbooks) {
    await writeFile(path.join(dir, 'playbooks', `${keyOf(row.externalKey, row.id)}.json`), JSON.stringify({
      key: keyOf(row.externalKey, row.id), name: row.name, platform: row.platform, contentType: row.contentType, pillar: row.pillar,
      body: row.body, hashtagMin: row.hashtagMin, hashtagMax: row.hashtagMax, maxChars: row.maxChars,
    }, null, 2));
  }
  const products = await prisma.product.findMany({ where: { organizationId: orgId, active: true } });
  await writeFile(path.join(dir, 'products.json'), JSON.stringify(products.map((row) => ({
    key: keyOf(row.externalKey, row.id), name: row.name, sku: row.sku, description: row.positioning || row.description,
    features: row.packFeatures.length ? row.packFeatures : row.features, pricing: row.pricing, url: row.url,
    links: row.packLinks.length ? row.packLinks : row.links, sensitivity: row.sensitivity,
  })), null, 2));
  const claims = await prisma.claim.findMany({ where: { organizationId: orgId } });
  await writeFile(path.join(dir, 'claims.json'), JSON.stringify(claims.map((row) => ({
    key: keyOf(row.externalKey, row.id), text: row.text, sourceUrl: row.sourceUrl, asOf: row.asOf?.toISOString(),
    expiresAt: row.expiresAt?.toISOString(), productKeys: [], sensitivity: row.sensitivity,
  })), null, 2));
  const accomplishments = await prisma.accomplishment.findMany({ where: { organizationId: orgId } });
  await writeFile(path.join(dir, 'accomplishments.json'), JSON.stringify(accomplishments.map((row) => ({
    key: keyOf(row.externalKey, row.id), title: row.title, description: row.description, date: row.date?.toISOString().slice(0, 10), sensitivity: row.sensitivity,
  })), null, 2));
  const sources = await prisma.source.findMany({ where: { organizationId: orgId, kind: { in: ['WEBSITE', 'ARTICLE', 'LINKEDIN', 'MANUAL'] }, url: { not: null } } });
  await writeFile(path.join(dir, 'sources.json'), JSON.stringify(sources.filter((row) => row.url && !row.url.startsWith('storage:')).map((row) => ({
    key: keyOf(row.externalKey, row.id), url: row.url, kind: row.kind, recrawlDays: row.recrawlDays, sensitivity: row.sensitivity,
  })), null, 2));
  const terms = await prisma.confidentialTerm.findMany({ where: { organizationId: orgId } });
  await writeFile(path.join(dir, 'confidential.json'), JSON.stringify(terms.map((row) => ({ term: row.term, aliases: row.aliases, note: row.note })), null, 2));
  const examples = await prisma.source.findMany({ where: { organizationId: orgId, kind: 'SAMPLE_POST' } });
  for (const row of examples) {
    const key = keyOf(row.externalKey, row.id);
    await writeFile(path.join(dir, 'examples', `${key}.md`), `---\nkey: ${key}\nplatform: ${row.platform ?? 'linkedin'}\n---\n\n${row.content}\n`);
  }
  const documents = await prisma.source.findMany({ where: { organizationId: orgId, kind: 'DOCUMENT' } });
  for (const row of documents) {
    const key = keyOf(row.externalKey, row.id);
    await writeFile(path.join(dir, 'documents', `${key}.md`), `---\nkey: ${key}\nsensitivity: ${row.sensitivity}\n---\n\n${row.content}\n`);
  }
}
