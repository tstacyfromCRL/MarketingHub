import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { quickLinkSchema } from '@mh/shared';
import { getDefaultOrgId } from '@mh/core';
import { authenticate, forbidden, isManager, notFound } from '../http';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Everything the dashboard needs in one round trip. */
  app.get('/dashboard', async (req) => {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86_400_000);
    // The last stage on the board is treated as "done".
    const doneStage = await prisma.stage.findFirst({ orderBy: { order: 'desc' }, select: { id: true } });
    const orgId = await getDefaultOrgId();
    const [myTasks, upcomingPosts, activity, links, awaitingReview, unread, drafts, draftCount, notifications, campaigns, articleHits, teamEvents] = await Promise.all([
      prisma.task.findMany({
        where: { assigneeId: req.user.id, active: true, stageId: doneStage ? { not: doneStage.id } : undefined },
        include: { stage: true, categories: true },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 10,
      }),
      prisma.post.findMany({
        where: { scheduledAt: { gte: new Date(now.getTime() - 86_400_000), lte: in14 }, status: { in: ['DRAFT', 'CREATOR_APPROVED', 'IN_REVIEW', 'SCHEDULED', 'POSTED', 'FAILED'] } },
        select: { id: true, title: true, status: true, scheduledAt: true, platforms: true },
        orderBy: { scheduledAt: 'asc' },
        take: 50,
      }),
      prisma.activityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 15, include: { actor: { select: { id: true, name: true } } } }),
      prisma.quickLink.findMany({ where: { OR: [{ userId: null }, { userId: req.user.id }] }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      isManager(req.user) ? prisma.post.count({ where: { status: { in: ['CREATOR_APPROVED', 'IN_REVIEW'] } } }) : Promise.resolve(0),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
      // Only this person's drafts. Anything already sent for approval leaves the Drafts list.
      prisma.post.findMany({
        where: { status: 'DRAFT', creatorId: req.user.id },
        select: { id: true, title: true, platforms: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.post.count({ where: { status: 'DRAFT', creatorId: req.user.id } }),
      prisma.notification.findMany({
        where: { userId: req.user.id, readAt: null },
        select: { id: true, title: true, body: true, link: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Campaigns that have not finished yet, soonest first.
      prisma.campaign.findMany({
        where: { endDate: { gte: now } },
        select: { id: true, name: true, startDate: true, endDate: true, status: true, _count: { select: { posts: true } } },
        orderBy: { startDate: 'asc' },
        take: 5,
      }),
      // Articles that were filed to the knowledge base, most recently filed first.
      prisma.articleHit.findMany({
        where: { sourceId: { not: null }, search: { organizationId: orgId } },
        select: { id: true, title: true, url: true, source: { select: { createdAt: true } } },
        orderBy: { source: { createdAt: 'desc' } },
        take: 5,
      }),
      // Time off, shoots, and events for the whole team that overlap the next two weeks.
      prisma.scheduleEvent.findMany({
        where: { startsAt: { lte: in14 }, endsAt: { gte: now } },
        select: { id: true, title: true, startsAt: true, endsAt: true, allDay: true, user: { select: { id: true, name: true } } },
        orderBy: { startsAt: 'asc' },
        take: 15,
      }),
    ]);
    return {
      myTasks,
      upcomingPosts,
      activity,
      links,
      awaitingReview,
      unreadNotifications: unread,
      drafts,
      draftCount,
      notifications,
      campaigns,
      articles: articleHits.map((hit) => ({ id: hit.id, title: hit.title, url: hit.url, filedAt: hit.source?.createdAt ?? null })),
      teamEvents,
    };
  });

  app.post('/quick-links', async (req) => {
    const body = quickLinkSchema.parse(req.body);
    if (body.shared && !isManager(req.user)) throw forbidden('Only managers can add company-wide links');
    return prisma.quickLink.create({ data: { label: body.label, url: body.url, sort: body.sort, userId: body.shared ? null : req.user.id } });
  });

  app.patch<{ Params: { id: string } }>('/quick-links/:id', async (req) => {
    const link = await prisma.quickLink.findUnique({ where: { id: req.params.id } });
    if (!link) throw notFound();
    if (link.userId ? link.userId !== req.user.id : !isManager(req.user)) throw forbidden();
    const body = quickLinkSchema.partial().parse(req.body);
    return prisma.quickLink.update({ where: { id: link.id }, data: { label: body.label, url: body.url, sort: body.sort } });
  });

  app.delete<{ Params: { id: string } }>('/quick-links/:id', async (req) => {
    const link = await prisma.quickLink.findUnique({ where: { id: req.params.id } });
    if (!link) throw notFound();
    if (link.userId ? link.userId !== req.user.id : !isManager(req.user)) throw forbidden();
    await prisma.quickLink.delete({ where: { id: link.id } });
    return { ok: true };
  });

  // ---- Notifications ----
  app.get<{ Querystring: { unread?: string } }>('/notifications', async (req) =>
    prisma.notification.findMany({
      where: { userId: req.user.id, ...(req.query.unread ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );

  app.post('/notifications/read', async (req) => {
    const ids = (req.body as { ids?: string[] } | undefined)?.ids;
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
