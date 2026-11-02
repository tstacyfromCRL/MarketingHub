import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { composeDesignSchema, designSchema, EXPORT_FORMATS, type ExportFormat } from '@mh/shared';
import { addedProductIds, composeDesign, newStorageKey, partitionDesignDeletion, recordEvent, renderDesignFile, saveDesign, storage } from '@mh/core';
import { authenticate, badRequest, forbidden, isManager } from '../http';

const designListSelect = {
  id: true,
  name: true,
  previewKey: true,
  folderId: true,
  canvaDesignId: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  products: { select: { product: { select: { id: true, name: true } } }, orderBy: { product: { name: 'asc' } } },
} as const;

const idsSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
});

export async function designRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/design-folders', async () =>
    prisma.designFolder.findMany({ orderBy: { name: 'asc' } }),
  );

  app.post('/design-folders', async (req) => {
    const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const folder = await prisma.designFolder.create({ data: { name: body.name } });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'designFolder', entityId: folder.id, summary: `Folder "${folder.name}" created by ${req.user.name}`, link: '/studio?tab=designs' });
    return folder;
  });

  app.delete<{ Params: { id: string } }>('/design-folders/:id', async (req) => {
    // The folder relation sets each graphic's folder to empty. The graphics stay.
    const folder = await prisma.designFolder.delete({ where: { id: req.params.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'designFolder', entityId: folder.id, summary: `Folder "${folder.name}" removed by ${req.user.name}`, link: '/studio?tab=designs' });
    return { ok: true };
  });

  app.get('/designs', async () =>
    prisma.design.findMany({
      select: designListSelect,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  );

  app.post('/designs/bulk-delete', async (req) => {
    const { ids } = idsSchema.parse(req.body);
    const rows = await prisma.design.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        previewKey: true,
        posts: { select: { status: true } },
        variants: { select: { post: { select: { status: true } } } },
      },
    });
    const statuses = (row: (typeof rows)[number]) => [
      ...row.posts.map((post) => post.status),
      ...row.variants.map((variant) => variant.post.status),
    ];
    const { deleteIds, kept } = partitionDesignDeletion(rows.map((row) => ({ id: row.id, statuses: statuses(row) })));
    if (deleteIds.length) {
      await prisma.design.deleteMany({ where: { id: { in: deleteIds } } });
      for (const row of rows) {
        if (deleteIds.includes(row.id) && row.previewKey) await storage.delete(row.previewKey).catch(() => undefined);
      }
      await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'design', entityId: deleteIds[0], summary: `${deleteIds.length} graphic${deleteIds.length === 1 ? '' : 's'} deleted by ${req.user.name}`, link: '/studio?tab=designs' });
    }
    return { deleted: deleteIds, kept: rows.filter((row) => kept.includes(row.id)).map((row) => row.name) };
  });

  app.patch('/designs/organize', async (req) => {
    const body = z.object({
      ids: z.array(z.string()).min(1).max(200),
      folderId: z.string().nullable().optional(),
      addProductIds: z.array(z.string()).max(50).optional(),
      removeProductIds: z.array(z.string()).max(50).optional(),
    }).parse(req.body);
    if (body.folderId) await prisma.designFolder.findUniqueOrThrow({ where: { id: body.folderId } });
    if (body.folderId !== undefined) {
      await prisma.design.updateMany({ where: { id: { in: body.ids } }, data: { folderId: body.folderId } });
    }
    if (body.removeProductIds?.length) {
      await prisma.designProduct.deleteMany({ where: { designId: { in: body.ids }, productId: { in: body.removeProductIds } } });
    }
    if (body.addProductIds?.length) {
      const products = await prisma.product.findMany({ where: { id: { in: body.addProductIds } }, select: { id: true } });
      const existing = await prisma.designProduct.findMany({
        where: { designId: { in: body.ids } },
        select: { designId: true, productId: true },
      });
      const rows = body.ids.flatMap((designId) => {
        const have = existing.filter((row) => row.designId === designId).map((row) => row.productId);
        return addedProductIds(have, products.map((product) => product.id)).map((productId) => ({ designId, productId }));
      });
      if (rows.length) await prisma.designProduct.createMany({ data: rows, skipDuplicates: true });
    }
    return { ok: true };
  });

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
