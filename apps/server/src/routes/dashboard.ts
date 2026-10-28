import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { quickLinkSchema } from '@mh/shared';
import { authenticate, forbidden, isManager, notFound } from '../http';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Everything the dashboard needs in one round trip. */
  app.get('/dashboard', async (req) => {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86_400_000);
    // The last stage on the board is treated as "done".
    const doneStage = await prisma.stage.findFirst({ orderBy: { order: 'desc' }, select: { id: true } });
    const [myTasks, upcomingPosts, activity, links, awaitingReview, unread] = await Promise.all([
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
    ]);
    return { myTasks, upcomingPosts, activity, links, awaitingReview, unreadNotifications: unread };
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
