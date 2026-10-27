import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { recordEvent } from '@mh/core';
import { DEFAULT_LIBRARY_NAME, collapseLibraryImports, libraryImportBatchSchema, libraryLocationSchema, normalizeImportPath, type LibraryLocation } from '@mh/shared';
import { authenticate, badRequest, forbidden, isManager, notFound, requireRole } from '../http';

const LOCATION_KEY = 'libraryLocation';

async function teamLibrary() {
  const [lib, setting] = await Promise.all([
    prisma.library.findFirst({ include: { lease: true } }),
    prisma.appSetting.findUnique({ where: { key: LOCATION_KEY } }),
  ]);
  const loc = setting ? libraryLocationSchema.safeParse(setting.value) : null;
  return {
    library: lib ? { id: lib.id, name: lib.name, createdAt: lib.createdAt } : null,
    location: loc?.success ? loc.data : null,
    lastScanAt: lib?.lease?.lastScanAt ?? null,
  };
}

export async function libraryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** The team library and where it lives on the network. Each PC finds that share among its own mapped drives. */
  app.get('/library', async () => teamLibrary());

  /** Admin sets (or changes) the network drive folder everyone's library points to. */
  app.put('/library', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body: LibraryLocation = libraryLocationSchema.parse(req.body);
    const existing = await prisma.library.findFirst();
    const lib = existing
      ? await prisma.library.update({ where: { id: existing.id }, data: { name: body.name } })
      : await prisma.library.create({ data: { name: body.name || DEFAULT_LIBRARY_NAME, createdById: req.user.id } });
    await prisma.appSetting.upsert({
      where: { key: LOCATION_KEY },
      update: { value: body },
      create: { key: LOCATION_KEY, value: body },
    });
    await recordEvent({
      actorId: req.user.id, verb: 'update', entityType: 'library', entityId: lib.id, link: '/settings/general',
      summary: `${lib.name} location set to ${body.uncPath ?? body.rootPath} by ${req.user.name}`,
    });
    return teamLibrary();
  });

  /** Files and folders the team has chosen to index. Paths are relative to the library drive. */
  app.get('/library/imports', async () => {
    const lib = await prisma.library.findFirst();
    if (!lib) return [];
    return prisma.libraryImport.findMany({ where: { libraryId: lib.id }, orderBy: { relPath: 'asc' } });
  });

  /** Adds imports. A folder replaces anything already imported inside it, and a path inside an existing folder is ignored. */
  app.post('/library/imports', async (req) => {
    const body = libraryImportBatchSchema.parse(req.body);
    const lib = await prisma.library.findFirst();
    if (!lib) throw badRequest('An admin needs to choose the library drive first');
    const existing = await prisma.libraryImport.findMany({ where: { libraryId: lib.id } });
    const collapsed = collapseLibraryImports([
      ...existing.map((row) => ({ relPath: row.relPath, kind: row.kind })),
      ...body.paths.map((p) => ({ relPath: normalizeImportPath(p.relPath), kind: p.kind })),
    ]);
    const keep = new Set(collapsed.map((c) => c.relPath.toLowerCase()));
    const dropped = existing.filter((row) => !keep.has(row.relPath.toLowerCase()));
    if (dropped.length) await prisma.libraryImport.deleteMany({ where: { id: { in: dropped.map((row) => row.id) } } });
    for (const item of collapsed) {
      const prior = existing.find((row) => row.relPath.toLowerCase() === item.relPath.toLowerCase());
      if (!prior) {
        await prisma.libraryImport.create({ data: { libraryId: lib.id, relPath: item.relPath, kind: item.kind, addedById: req.user.id } });
      } else if (prior.kind !== item.kind || prior.relPath !== item.relPath) {
        await prisma.libraryImport.update({ where: { id: prior.id }, data: { kind: item.kind, relPath: item.relPath } });
      }
    }
    const reimported = collapsed.filter((item) => item.kind === 'FILE').map((item) => item.relPath);
    if (reimported.length) {
      await prisma.asset.updateMany({ where: { libraryId: lib.id, relPath: { in: reimported }, excluded: true }, data: { excluded: false, missing: false } });
    }
    const added = collapsed.filter((item) => !existing.some((row) => row.relPath.toLowerCase() === item.relPath.toLowerCase()));
    if (added.length) {
      await recordEvent({
        actorId: req.user.id, verb: 'import', entityType: 'library', entityId: lib.id, link: '/library',
        summary: `${req.user.name} imported ${added.map((item) => item.relPath || 'the whole drive').join(', ')} into the library`,
      });
    }
    return prisma.libraryImport.findMany({ where: { libraryId: lib.id }, orderBy: { relPath: 'asc' } });
  });

  /** Removes an import. The files stay on the drive; indexed copies of them drop out of the library. */
  app.delete<{ Params: { id: string } }>('/library/imports/:id', async (req) => {
    const row = await prisma.libraryImport.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound();
    if (row.addedById !== req.user.id && !isManager(req.user)) throw forbidden();
    await prisma.libraryImport.delete({ where: { id: row.id } });
    const under = row.kind === 'FILE'
      ? { relPath: row.relPath }
      : row.relPath === ''
        ? {}
        : { OR: [{ relPath: row.relPath }, { relPath: { startsWith: `${row.relPath}/` } }] };
    await prisma.asset.updateMany({ where: { libraryId: row.libraryId, ...under }, data: { missing: true } });
    await recordEvent({
      actorId: req.user.id, verb: 'remove', entityType: 'library', entityId: row.libraryId, link: '/library',
      summary: `${req.user.name} removed ${row.relPath || 'the whole drive'} from the library index`,
    });
    return { ok: true };
  });

  /** Records whether this user's PC can currently reach the library (the resolved path stays on their PC). */
  app.put('/me/library', async (req) => {
    const body = z.object({ configured: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.user.id }, data: { libraryConfigured: body.configured } });
    return { ok: true };
  });
}
