import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { recordEvent } from '@mh/core';
import { DEFAULT_LIBRARY_NAME, libraryLocationSchema, type LibraryLocation } from '@mh/shared';
import { authenticate, requireRole } from '../http';

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

  /** Records whether this user's PC can currently reach the library (the resolved path stays on their PC). */
  app.put('/me/library', async (req) => {
    const body = z.object({ configured: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.user.id }, data: { libraryConfigured: body.configured } });
    return { ok: true };
  });
}
