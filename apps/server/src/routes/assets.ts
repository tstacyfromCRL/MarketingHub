import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '@mh/db';
import { assetProductSchema, libraryAssetBatchSchema, libraryBatchEditSchema, libraryRelocateSchema, libraryScanCompleteSchema, normalizeImportPath } from '@mh/shared';
import { bus, enqueue, newStorageKey, randomToken, recordEvent, storage } from '@mh/core';
import { authenticate, badRequest, conflict, HttpError, notFound } from '../http';

const LEASE_MS = 5 * 60_000;

async function theLibrary() {
  const lib = await prisma.library.findFirst();
  if (!lib) throw badRequest('The team library has not been set up yet');
  return lib;
}

async function requireLease(token: string) {
  const lease = await prisma.scanLease.findUnique({ where: { token } });
  if (!lease || lease.expiresAt < new Date()) throw new HttpError(409, 'Your scan lease expired; another computer may be scanning');
  await prisma.scanLease.update({ where: { token }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } });
  return lease;
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---------------------------------------------------------------------------
  // Indexing protocol used by desktop clients (one scanner at a time)
  // ---------------------------------------------------------------------------

  /** Claim the scan lease. Returns 409 while another machine holds a live lease. */
  app.post('/library/lease', async (req) => {
    const body = z.object({ machine: z.string().min(1), force: z.boolean().default(false) }).parse(req.body);
    const lib = await theLibrary();
    const token = randomToken();
    const now = new Date();
    const existing = await prisma.scanLease.findUnique({ where: { libraryId: lib.id } });
    if (existing && existing.expiresAt > now && existing.holderId !== req.user.id && !body.force) {
      throw conflict('Another computer is scanning the library right now');
    }
    const lease = await prisma.scanLease.upsert({
      where: { libraryId: lib.id },
      update: { token, holderId: req.user.id, machine: body.machine, expiresAt: new Date(now.getTime() + LEASE_MS), startedAt: now },
      create: { libraryId: lib.id, token, holderId: req.user.id, machine: body.machine, expiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    return { token: lease.token, expiresAt: lease.expiresAt, lastScanAt: lease.lastScanAt };
  });

  /** Keeps a lease alive during long directory walks that have no changes to upload. */
  app.post('/library/lease/renew', async (req) => {
    const body = z.object({ leaseToken: z.string() }).parse(req.body);
    const lease = await requireLease(body.leaseToken);
    return { ok: true, expiresAt: new Date(Date.now() + LEASE_MS), libraryId: lease.libraryId };
  });

  /** Compact index of what the server already knows, so clients only send new/changed files. */
  app.get('/library/index', async () => {
    const lib = await theLibrary();
    const rows = await prisma.asset.findMany({ where: { libraryId: lib.id, missing: false }, select: { relPath: true, size: true, mtime: true, thumbnailKey: true } });
    return rows.map((r) => [r.relPath, Number(r.size), r.mtime.getTime(), Boolean(r.thumbnailKey)] as const);
  });

  app.post('/library/assets/batch', async (req) => {
    const body = libraryAssetBatchSchema.parse(req.body);
    const lease = await requireLease(body.leaseToken);
    let tagged = 0;
    for (const a of body.assets) {
      const old = await prisma.asset.findUnique({ where: { libraryId_relPath: { libraryId: lease.libraryId, relPath: a.relPath } } });
      if (old?.excluded) continue;
      let thumbnailKey: string | undefined;
      if (a.thumbnail) {
        thumbnailKey = newStorageKey('thumbs', 'png');
        await storage.put(thumbnailKey, Buffer.from(a.thumbnail, 'base64'), 'image/png');
      }
      const data = { size: BigInt(a.size), mtime: new Date(a.mtime), kind: a.kind, missing: false, indexedAt: new Date(), ...(thumbnailKey ? { thumbnailKey, needsTagging: true } : {}) };
      const asset = await prisma.asset.upsert({
        where: { libraryId_relPath: { libraryId: lease.libraryId, relPath: a.relPath } },
        update: data,
        create: { libraryId: lease.libraryId, relPath: a.relPath, tags: [], ...data },
      });
      if (old?.thumbnailKey && thumbnailKey) await storage.delete(old.thumbnailKey).catch(() => undefined);
      if (thumbnailKey) {
        await enqueue('tag-asset', { assetId: asset.id });
        tagged++;
      }
    }
    return { ok: true, received: body.assets.length, tagging: tagged };
  });

  app.post('/library/scan-complete', async (req) => {
    const body = libraryScanCompleteSchema.parse(req.body);
    const lease = await requireLease(body.leaseToken);
    const seen = new Set(body.seenPaths);
    const all = await prisma.asset.findMany({ where: { libraryId: lease.libraryId, missing: false }, select: { id: true, relPath: true } });
    const gone = all.filter((a) => !seen.has(a.relPath)).map((a) => a.id);
    if (gone.length) await prisma.asset.updateMany({ where: { id: { in: gone } }, data: { missing: true } });
    await prisma.scanLease.update({ where: { token: body.leaseToken }, data: { lastScanAt: new Date(), expiresAt: new Date() } });
    const user = await prisma.user.findUnique({ where: { id: lease.holderId } });
    await recordEvent({
      actorId: lease.holderId, verb: 'scan', entityType: 'library', entityId: lease.libraryId, link: '/library',
      summary: `Library scan finished on ${lease.machine} (${user?.name ?? 'unknown'}): ${seen.size} files${gone.length ? `, ${gone.length} no longer found` : ''}`,
    });
    bus.publish({ userId: '*', type: 'library', payload: { scanned: true } });
    return { ok: true, missing: gone.length };
  });

  // ---------------------------------------------------------------------------
  // Browsing
  // ---------------------------------------------------------------------------

  /** Paths a user removed from the library. The scanner must not add them back. */
  app.get('/library/exclusions', async () => {
    const lib = await prisma.library.findFirst();
    if (!lib) return [];
    const rows = await prisma.asset.findMany({ where: { libraryId: lib.id, excluded: true }, select: { relPath: true } });
    return rows.map((row) => row.relPath);
  });

  /** Add tags, assign a product, or remove several files from the library at once. */
  app.post('/library/assets/batch-edit', async (req) => {
    const body = libraryBatchEditSchema.parse(req.body);
    const lib = await theLibrary();
    const assets = await prisma.asset.findMany({ where: { id: { in: body.ids }, libraryId: lib.id } });
    if (body.remove) {
      await prisma.asset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { excluded: true, missing: true } });
      await prisma.libraryImport.deleteMany({ where: { libraryId: lib.id, kind: 'FILE', relPath: { in: assets.map((a) => a.relPath) } } });
      await recordEvent({
        actorId: req.user.id, verb: 'remove', entityType: 'library', entityId: lib.id, link: '/library',
        summary: `${req.user.name} removed ${assets.length} file${assets.length === 1 ? '' : 's'} from the library`,
      });
    }
    if (body.addTags?.length) {
      const extra = body.addTags.map((tag) => tag.toLowerCase());
      for (const asset of assets) {
        await prisma.asset.update({ where: { id: asset.id }, data: { tags: [...new Set([...asset.tags, ...extra])] } });
      }
    }
    if (body.productId) {
      for (const asset of assets) {
        await prisma.assetProduct.upsert({
          where: { assetId_productId: { assetId: asset.id, productId: body.productId } },
          update: { confirmed: true },
          create: { assetId: asset.id, productId: body.productId, confirmed: true, similarity: 1 },
        });
      }
      await enqueue('rematch-products', { productId: body.productId });
    }
    return { ok: true, count: assets.length };
  });

  /** Points indexed files at a new folder after the desktop app has moved them on the shared drive. */
  app.post('/library/assets/relocate', async (req) => {
    const body = libraryRelocateSchema.parse(req.body);
    const lib = await theLibrary();
    const folder = normalizeImportPath(body.folder);
    if (!folder || folder.split('/').some((part) => part === '..' || part === '.')) throw badRequest('Choose a folder inside the library');
    for (const move of body.moves) {
      const relPath = normalizeImportPath(move.relPath);
      if (!relPath.toLowerCase().startsWith(`${folder.toLowerCase()}/`) || relPath.split('/').includes('..')) throw badRequest('That file would land outside the folder');
      const asset = await prisma.asset.findFirst({ where: { id: move.id, libraryId: lib.id } });
      if (!asset) throw notFound();
      const taken = await prisma.asset.findUnique({ where: { libraryId_relPath: { libraryId: lib.id, relPath } } });
      if (taken && taken.id !== asset.id) throw conflict(`"${relPath.split('/').pop()}" is already in that folder`);
      await prisma.asset.update({ where: { id: asset.id }, data: { relPath } });
    }
    const existing = await prisma.libraryImport.findMany({ where: { libraryId: lib.id } });
    if (!existing.some((row) => row.kind === 'FOLDER' && (row.relPath === '' || folder.toLowerCase() === row.relPath.toLowerCase() || folder.toLowerCase().startsWith(`${row.relPath.toLowerCase()}/`)))) {
      await prisma.libraryImport.create({ data: { libraryId: lib.id, relPath: folder, kind: 'FOLDER', addedById: req.user.id } });
    }
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string; kind?: string; productId?: string; folder?: string; untagged?: string; page?: string } }>('/library/assets', async (req) => {
    const lib = await prisma.library.findFirst();
    if (!lib) return { items: [], total: 0 };
    const page = Math.max(1, Number(req.query.page ?? 1));
    const q = req.query.q?.trim();
    const where: Prisma.AssetWhereInput = {
      libraryId: lib.id,
      missing: false,
      excluded: false,
      kind: (req.query.kind as never) || undefined,
      relPath: req.query.folder ? { startsWith: `${req.query.folder.replace(/\/$/, '')}/` } : undefined,
      needsTagging: req.query.untagged ? true : undefined,
      products: req.query.productId ? { some: { productId: req.query.productId, OR: [{ confirmed: null }, { confirmed: true }] } } : undefined,
      OR: q
        ? [{ relPath: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }, { tags: { has: q.toLowerCase() } }]
        : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: { products: { include: { product: { select: { id: true, name: true } } } } },
        orderBy: { mtime: 'desc' },
        skip: (page - 1) * 60,
        take: 60,
      }),
      prisma.asset.count({ where }),
    ]);
    return { items, total, page, pageSize: 60 };
  });

  app.get<{ Params: { id: string } }>('/library/assets/:id', async (req) =>
    prisma.asset.findUniqueOrThrow({ where: { id: req.params.id }, include: { products: { include: { product: true } } } }),
  );

  app.patch<{ Params: { id: string } }>('/library/assets/:id', async (req) => {
    const body = z.object({ description: z.string().optional(), tags: z.array(z.string()).optional() }).parse(req.body);
    return prisma.asset.update({ where: { id: req.params.id }, data: { description: body.description, tags: body.tags?.map((t) => t.toLowerCase()) } });
  });

  /** The desktop app uploads the full file when a user uses an asset in generated content. */
  app.post<{ Params: { id: string } }>('/library/assets/:id/upload', async (req) => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: req.params.id } });
    if (asset.storedKey) return asset;
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    const buf = await file.toBuffer();
    const ext = asset.relPath.split('.').pop() ?? 'bin';
    const key = newStorageKey('library', ext);
    await storage.put(key, buf, file.mimetype);
    const updated = await prisma.asset.update({ where: { id: asset.id }, data: { storedKey: key } });
    await recordEvent({ actorId: req.user.id, verb: 'upload', entityType: 'asset', entityId: asset.id, summary: `Library file "${asset.relPath}" uploaded for content use by ${req.user.name}`, link: `/library?asset=${asset.id}` });
    return updated;
  });

  /** Confirm or reject a product match. Confirmations update the product's visual centroid. */
  app.put<{ Params: { id: string } }>('/library/assets/:id/products', async (req) => {
    const body = assetProductSchema.parse(req.body);
    await prisma.assetProduct.upsert({
      where: { assetId_productId: { assetId: req.params.id, productId: body.productId } },
      update: { confirmed: body.confirmed },
      create: { assetId: req.params.id, productId: body.productId, confirmed: body.confirmed, similarity: 1 },
    });
    await enqueue('rematch-products', { productId: body.productId });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/library/assets/:id/retag', async (req) => {
    await prisma.asset.update({ where: { id: req.params.id }, data: { needsTagging: true } });
    await enqueue('tag-asset', { assetId: req.params.id });
    return { ok: true };
  });

  app.get('/library/stats', async () => {
    const lib = await prisma.library.findFirst({ include: { lease: true } });
    if (!lib) return null;
    const [byKind, untagged, missing] = await Promise.all([
      prisma.asset.groupBy({ by: ['kind'], where: { libraryId: lib.id, missing: false }, _count: true }),
      prisma.asset.count({ where: { libraryId: lib.id, missing: false, needsTagging: true, thumbnailKey: { not: null } } }),
      prisma.asset.count({ where: { libraryId: lib.id, missing: true, excluded: false } }),
    ]);
    return {
      byKind: Object.fromEntries(byKind.map((k) => [k.kind, k._count])),
      untagged,
      missing,
      lastScanAt: lib.lease?.lastScanAt ?? null,
      scanning: lib.lease && lib.lease.expiresAt > new Date() ? { machine: lib.lease.machine, since: lib.lease.startedAt } : null,
    };
  });
}
