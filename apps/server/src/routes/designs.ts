import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { prisma } from '@mh/db';
import { composeDesignSchema, designSchema, EXPORT_FORMATS, type ExportFormat } from '@mh/shared';
import { composeDesign, newStorageKey, recordEvent, renderDesignFile, saveDesign, storage } from '@mh/core';
import { authenticate, badRequest, forbidden, isManager } from '../http';

export async function designRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/designs', async () =>
    prisma.design.findMany({
      select: { id: true, name: true, previewKey: true, updatedAt: true, createdBy: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  );

  app.get<{ Params: { id: string } }>('/designs/:id', async (req) => prisma.design.findUniqueOrThrow({ where: { id: req.params.id } }));

  app.post('/designs', async (req) => {
    const body = designSchema.parse(req.body);
    const d = await saveDesign({ name: body.name, doc: body.doc, userId: req.user.id });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'design', entityId: d.id, summary: `Design "${d.name}" created by ${req.user.name}`, link: `/designs/${d.id}` });
    return d;
  });

  app.put<{ Params: { id: string } }>('/designs/:id', async (req) => {
    const body = designSchema.parse(req.body);
    const existing = await prisma.design.findUniqueOrThrow({ where: { id: req.params.id }, include: { posts: { select: { status: true } }, variants: { select: { post: { select: { status: true } } } } } });
    const statuses = [...existing.posts.map((p) => p.status), ...existing.variants.map((v) => v.post.status)];
    if (statuses.some((s) => s === 'SCHEDULED' || s === 'POSTED')) throw badRequest('This design belongs to a scheduled or posted post. Unschedule the post to edit it.');
    if (statuses.includes('IN_REVIEW') && !isManager(req.user)) throw forbidden('Only managers can edit a post under review');
    const d = await saveDesign({ id: existing.id, name: body.name, doc: body.doc, userId: req.user.id });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'design', entityId: d.id, summary: `Design "${d.name}" edited by ${req.user.name}`, link: `/designs/${d.id}` });
    return d;
  });

  app.delete<{ Params: { id: string } }>('/designs/:id', async (req) => {
    const d = await prisma.design.delete({ where: { id: req.params.id } });
    if (d.previewKey) await storage.delete(d.previewKey).catch(() => undefined);
    return { ok: true };
  });

  /** AI layout: generated background + brand colors + logo + headline, as an editable design. */
  app.post('/designs/compose', async (req) => {
    const body = composeDesignSchema.parse(req.body);
    let productImageKey: string | undefined;
    if (body.productAssetId) {
      const asset = await prisma.asset.findUniqueOrThrow({ where: { id: body.productAssetId } });
      if (asset.notForPublicUse) throw badRequest('That library file is not for public use.');
      productImageKey = asset.storedKey ?? asset.thumbnailKey ?? undefined;
    }
    const { doc } = await composeDesign({ ...body, productImageKey });
    return { doc };
  });

  /** Upload an image to place into a design layer. */
  app.post('/designs/images', async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    const png = await sharp(await file.toBuffer()).rotate().png().toBuffer();
    const key = newStorageKey('design-images', 'png');
    await storage.put(key, png, 'image/png');
    const meta = await sharp(png).metadata();
    return { key, width: meta.width, height: meta.height };
  });

  /** Download a layered file: png, psd, svg, pdf or idml. */
  app.get<{ Params: { id: string; format: string } }>('/designs/:id/export/:format', async (req, reply) => {
    const format = req.params.format as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) throw badRequest(`Format must be one of ${EXPORT_FORMATS.join(', ')}`);
    const file = await renderDesignFile(req.params.id, format);
    await recordEvent({ actorId: req.user.id, verb: 'export', entityType: 'design', entityId: req.params.id, summary: `"${file.filename}" exported by ${req.user.name}`, link: `/designs/${req.params.id}` });
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return reply.send(file.body);
  });
}
