import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { articleAssignSchema, articleSearchSchema } from '@mh/shared';
import { assignArticleHit, getDefaultOrgId, recordEvent, runArticleSearch } from '@mh/core';
import { authenticate, badRequest, notFound } from '../http';

const hitInclude = {
  orderBy: { foundAt: 'desc' as const },
  include: { source: { select: { id: true, status: true, error: true, productId: true, projectId: true } } },
};

export async function articleSearchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/article-searches', async () =>
    prisma.articleSearch.findMany({
      where: { organizationId: await getDefaultOrgId() },
      orderBy: { createdAt: 'desc' },
      include: { hits: hitInclude },
    }),
  );

  app.post('/article-searches', async (req) => {
    const body = articleSearchSchema.parse(req.body);
    return prisma.articleSearch.create({
      data: { organizationId: await getDefaultOrgId(), keywords: body.keywords, intervalDays: body.intervalDays },
      include: { hits: hitInclude },
    });
  });

  app.patch<{ Params: { id: string } }>('/article-searches/:id', async (req) => {
    const body = z.object({
      keywords: z.string().trim().min(1).max(300).optional(),
      intervalDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]).optional(),
    }).parse(req.body);
    const orgId = await getDefaultOrgId();
    const existing = await prisma.articleSearch.findFirst({ where: { id: req.params.id, organizationId: orgId } });
    if (!existing) throw notFound();
    return prisma.articleSearch.update({
      where: { id: existing.id },
      data: {
        ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
        ...(body.intervalDays !== undefined ? { intervalDays: body.intervalDays } : {}),
      },
      include: { hits: hitInclude },
    });
  });

  app.delete<{ Params: { id: string } }>('/article-searches/:id', async (req) => {
    const existing = await prisma.articleSearch.findFirst({ where: { id: req.params.id, organizationId: await getDefaultOrgId() } });
    if (!existing) throw notFound();
    await prisma.articleSearch.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/article-searches/:id/run', async (req) => {
    const existing = await prisma.articleSearch.findFirst({ where: { id: req.params.id, organizationId: await getDefaultOrgId() } });
    if (!existing) throw notFound();
    try {
      const count = await runArticleSearch(existing.id);
      return { count };
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'The search failed.');
    }
  });

  app.get('/article-links', async () =>
    prisma.source.findMany({
      where: { organizationId: await getDefaultOrgId(), origin: 'search', url: { not: null } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, url: true },
    }),
  );

  app.get('/projects', async () =>
    prisma.project.findMany({ where: { organizationId: await getDefaultOrgId() }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  );

  app.post('/projects', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(160) }).parse(req.body);
    return prisma.project.create({ data: { organizationId: await getDefaultOrgId(), name } });
  });

  app.post<{ Params: { id: string } }>('/article-hits/:id/assign', async (req) => {
    const body = articleAssignSchema.parse(req.body);
    if (body.scope === 'product' && !body.productId) throw badRequest('Choose a product.');
    if (body.scope === 'project' && !body.projectId) throw badRequest('Choose a project.');
    const hit = await prisma.articleHit.findFirst({ where: { id: req.params.id, search: { organizationId: await getDefaultOrgId() } } });
    if (!hit) throw notFound();
    try {
      const saved = await assignArticleHit(hit.id, {
        productId: body.scope === 'product' ? body.productId! : null,
        projectId: body.scope === 'project' ? body.projectId! : null,
      });
      const where = body.scope === 'product' ? 'a product' : body.scope === 'project' ? 'a project' : 'the company';
      await recordEvent({
        actorId: req.user.id,
        verb: 'create',
        entityType: 'source',
        entityId: saved.sourceId,
        summary: `Article "${saved.title}" filed under ${where} by ${req.user.name}`,
        link: '/knowledge/articles',
      });
      return saved;
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'The article could not be saved.');
    }
  });
}
