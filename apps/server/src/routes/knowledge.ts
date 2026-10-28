import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { prisma } from '@mh/db';
import { accomplishmentSchema, brandProfileSchema, productSchema, sourceSchema } from '@mh/shared';
import { brandProfile, enqueue, getDefaultOrgId, isLinkedIn, newStorageKey, recordEvent, retrieve, storage } from '@mh/core';
import { authenticate, badRequest, requireRole } from '../http';

export async function knowledgeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- Brand profile ----
  app.get('/brand', async () => brandProfile());

  app.put('/brand', async (req) => {
    const body = brandProfileSchema.parse(req.body);
    const current = await brandProfile();
    await prisma.brandProfile.update({ where: { id: current.id }, data: body });
    await enqueue('embed-knowledge', { orgId: current.organizationId, sourceType: 'BRAND', sourceId: current.id });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'brand', entityId: current.id, summary: `Brand profile updated by ${req.user.name}`, link: '/knowledge/profile' });
    return brandProfile();
  });

  /** Updates only the fields sent (used by the setup wizard and the Brand Kit page). */
  app.patch('/brand', async (req) => {
    const body = brandProfileSchema.partial().parse(req.body);
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const current = await brandProfile();
    await prisma.brandProfile.update({ where: { id: current.id }, data });
    await enqueue('embed-knowledge', { orgId: current.organizationId, sourceType: 'BRAND', sourceId: current.id });
    return brandProfile();
  });

  // ---- Brand files (logos, graphics, fonts) ----
  app.get<{ Querystring: { kind?: string } }>('/brand/files', async (req) =>
    prisma.brandFile.findMany({ where: { kind: (req.query.kind as never) || { in: ['LOGO', 'GRAPHIC', 'FONT'] } }, orderBy: { createdAt: 'desc' }, take: 200 }),
  );

  app.post<{ Querystring: { kind?: string } }>('/brand/files', async (req) => {
    const kind = (req.query.kind ?? 'GRAPHIC').toUpperCase();
    if (!['LOGO', 'GRAPHIC', 'FONT'].includes(kind)) throw badRequest('kind must be LOGO, GRAPHIC or FONT');
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    let buf = await file.toBuffer();
    let ext = (file.filename.split('.').pop() ?? 'bin').toLowerCase();
    let mime = file.mimetype;
    if (kind !== 'FONT' && !['png', 'svg'].includes(ext)) {
      buf = await sharp(buf).png().toBuffer();
      ext = 'png';
      mime = 'image/png';
    }
    const key = newStorageKey(`brand/${kind.toLowerCase()}`, ext);
    await storage.put(key, buf, mime);
    const row = await prisma.brandFile.create({ data: { kind: kind as never, name: file.filename, storageKey: key, mime, size: buf.length } });
    await recordEvent({ actorId: req.user.id, verb: 'upload', entityType: 'brandFile', entityId: row.id, summary: `${kind.toLowerCase()} "${file.filename}" uploaded by ${req.user.name}`, link: '/brand-kit' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/brand/files/:id', async (req) => {
    const row = await prisma.brandFile.delete({ where: { id: req.params.id } });
    await storage.delete(row.storageKey).catch(() => undefined);
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'brandFile', entityId: row.id, summary: `"${row.name}" removed from brand files by ${req.user.name}`, link: '/brand-kit' });
    return { ok: true };
  });

  // ---- Products ----
  app.get('/products', async () =>
    prisma.product.findMany({
      where: { organizationId: await getDefaultOrgId() },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: { where: { confirmed: true } } } } },
    }),
  );

  app.get<{ Params: { id: string } }>('/products/:id', async (req) =>
    prisma.product.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { assets: { where: { OR: [{ confirmed: null }, { confirmed: true }] }, include: { asset: true }, orderBy: { similarity: 'desc' }, take: 60 } },
    }),
  );

  app.post('/products', async (req) => {
    const body = productSchema.parse(req.body);
    const p = await prisma.product.create({ data: { ...body, organizationId: await getDefaultOrgId() } });
    await enqueue('embed-knowledge', { orgId: p.organizationId, sourceType: 'PRODUCT', sourceId: p.id });
    await enqueue('rematch-products', { productId: p.id });
    if (p.links.length) await enqueue('scrape-product-links', { productId: p.id });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'product', entityId: p.id, summary: `Product "${p.name}" added by ${req.user.name}`, link: `/products/${p.id}` });
    return p;
  });

  app.patch<{ Params: { id: string } }>('/products/:id', async (req) => {
    const body = productSchema.partial().parse(req.body);
    const p = await prisma.product.update({ where: { id: req.params.id }, data: body });
    await enqueue('embed-knowledge', { orgId: p.organizationId, sourceType: 'PRODUCT', sourceId: p.id });
    if (body.links) await enqueue('scrape-product-links', { productId: p.id });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'product', entityId: p.id, summary: `Product "${p.name}" updated by ${req.user.name}`, link: `/products/${p.id}` });
    return p;
  });

  app.delete<{ Params: { id: string } }>('/products/:id', async (req) => {
    const p = await prisma.product.delete({ where: { id: req.params.id } });
    await enqueue('embed-knowledge', { orgId: p.organizationId, sourceType: 'PRODUCT', sourceId: p.id });
    await enqueue('scrape-product-links', { productId: p.id });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'product', entityId: p.id, summary: `Product "${p.name}" removed by ${req.user.name}`, link: '/products' });
    return { ok: true };
  });

  // ---- Accomplishments ----
  app.get('/accomplishments', async () => prisma.accomplishment.findMany({ where: { organizationId: await getDefaultOrgId() }, orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] }));

  app.post('/accomplishments', async (req) => {
    const body = accomplishmentSchema.parse(req.body);
    const a = await prisma.accomplishment.create({ data: { ...body, date: body.date ? new Date(body.date) : null, organizationId: await getDefaultOrgId() } });
    await enqueue('embed-knowledge', { orgId: a.organizationId, sourceType: 'ACCOMPLISHMENT', sourceId: a.id });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'accomplishment', entityId: a.id, summary: `Accomplishment "${a.title}" added by ${req.user.name}`, link: '/knowledge/accomplishments' });
    return a;
  });

  app.patch<{ Params: { id: string } }>('/accomplishments/:id', async (req) => {
    const body = accomplishmentSchema.partial().parse(req.body);
    const a = await prisma.accomplishment.update({
      where: { id: req.params.id },
      data: { ...body, date: body.date === undefined ? undefined : body.date ? new Date(body.date) : null },
    });
    await enqueue('embed-knowledge', { orgId: a.organizationId, sourceType: 'ACCOMPLISHMENT', sourceId: a.id });
    return a;
  });

  app.delete<{ Params: { id: string } }>('/accomplishments/:id', async (req) => {
    const a = await prisma.accomplishment.delete({ where: { id: req.params.id } });
    await enqueue('embed-knowledge', { orgId: a.organizationId, sourceType: 'ACCOMPLISHMENT', sourceId: a.id });
    return { ok: true };
  });

  // ---- Sources (links to scrape, or pasted text) ----
  app.get('/sources', async () =>
    prisma.source.findMany({
      where: { organizationId: await getDefaultOrgId(), kind: { not: 'DOCUMENT' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, kind: true, title: true, status: true, error: true, recrawlDays: true, lastCrawledAt: true, createdAt: true, productId: true, platform: true },
    }),
  );

  app.get<{ Params: { id: string } }>('/sources/:id', async (req) => prisma.source.findUniqueOrThrow({ where: { id: req.params.id } }));

  app.post('/sources', async (req) => {
    const body = sourceSchema.parse(req.body);
    let kind = body.kind;
    if (body.url && isLinkedIn(body.url)) kind = 'LINKEDIN';
    if (body.kind === 'SAMPLE_POST') kind = 'SAMPLE_POST';
    if ((kind === 'LINKEDIN' || kind === 'MANUAL' || kind === 'SAMPLE_POST') && !body.content.trim()) {
      throw badRequest(kind === 'LINKEDIN' ? 'LinkedIn does not allow scraping. Paste the post text into the content box.' : 'Paste the text for this source');
    }
    if ((kind === 'WEBSITE' || kind === 'ARTICLE') && !body.url) throw badRequest('A URL is required');
    const s = await prisma.source.create({
      data: {
        organizationId: await getDefaultOrgId(),
        url: body.url,
        kind,
        title: body.title || (kind === 'SAMPLE_POST' ? `Sample post${body.platform ? ` (${body.platform})` : ''}` : ''),
        content: body.content,
        platform: body.platform,
        recrawlDays: kind === 'SAMPLE_POST' ? null : body.recrawlDays,
      },
    });
    await enqueue('scrape-source', { orgId: s.organizationId, sourceId: s.id });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'source', entityId: s.id, summary: `Knowledge source ${s.url ?? `"${s.title || 'pasted text'}"`} added by ${req.user.name}`, link: '/knowledge/sources' });
    return s;
  });

  app.patch<{ Params: { id: string } }>('/sources/:id', async (req) => {
    const body = sourceSchema.partial().parse(req.body);
    const s = await prisma.source.update({
      where: { id: req.params.id },
      data: { title: body.title, content: body.content, recrawlDays: body.recrawlDays, url: body.url, platform: body.platform },
    });
    if (body.content !== undefined) await enqueue('embed-knowledge', { orgId: s.organizationId, sourceType: 'SOURCE', sourceId: s.id });
    return s;
  });

  app.post<{ Params: { id: string } }>('/sources/:id/refresh', async (req) => {
    await prisma.source.update({ where: { id: req.params.id }, data: { status: 'PENDING', error: null } });
    await enqueue('scrape-source', { orgId: await getDefaultOrgId(), sourceId: req.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/sources/:id', async (req) => {
    const s = await prisma.source.delete({ where: { id: req.params.id } });
    await enqueue('embed-knowledge', { orgId: s.organizationId, sourceType: 'SOURCE', sourceId: s.id });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'source', entityId: s.id, summary: `Knowledge source ${s.url ?? s.title} removed by ${req.user.name}`, link: '/knowledge/sources' });
    return { ok: true };
  });

  /** "What does the app know about X?" — shows the passages generation would use. */
  app.get<{ Querystring: { q: string } }>('/knowledge/search', async (req) => {
    if (!req.query.q?.trim()) return [];
    return retrieve(await getDefaultOrgId(), req.query.q, 10);
  });

  app.post('/knowledge/reindex', { preHandler: requireRole('ADMIN') }, async (req) => {
    await enqueue('reindex-knowledge', { orgId: await getDefaultOrgId() });
    await recordEvent({ actorId: req.user.id, verb: 'reindex', entityType: 'knowledge', entityId: 'all', summary: `Knowledge base re-index started by ${req.user.name}` });
    return { ok: true };
  });
}
