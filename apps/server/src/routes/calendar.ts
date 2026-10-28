import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { scheduleEventSchema } from '@mh/shared';
import { recordEvent } from '@mh/core';
import { authenticate, badRequest, forbidden, isManager } from '../http';

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /**
   * Combined calendar: social posts, task due dates and each member's schedule entries
   * (time off, shoots, events) for a date range.
   */
  app.get<{ Querystring: { from: string; to: string } }>('/calendar', async (req) => {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('from and to are required');
    const [posts, tasks, schedule] = await Promise.all([
      prisma.post.findMany({
        where: { OR: [{ scheduledAt: { gte: from, lte: to } }, { postedAt: { gte: from, lte: to } }] },
        select: { id: true, title: true, status: true, scheduledAt: true, postedAt: true, platforms: true, creatorId: true, campaignId: true },
      }),
      prisma.task.findMany({
        where: { active: true, dueDate: { gte: from, lte: to } },
        select: { id: true, title: true, dueDate: true, assigneeId: true, stage: { select: { name: true, color: true } } },
      }),
      prisma.scheduleEvent.findMany({
        where: { startsAt: { lte: to }, endsAt: { gte: from } },
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);
    return { posts, tasks, schedule };
  });

  /** Managers can add entries for any member; everyone else only for themselves. */
  app.post('/schedule', async (req) => {
    const body = scheduleEventSchema.parse(req.body);
    const userId = body.userId ?? req.user.id;
    if (userId !== req.user.id && !isManager(req.user)) throw forbidden();
    if (new Date(body.endsAt) < new Date(body.startsAt)) throw badRequest('End must be after start');
    const ev = await prisma.scheduleEvent.create({
      data: { userId, title: body.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), allDay: body.allDay, notes: body.notes },
      include: { user: { select: { id: true, name: true } } },
    });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'schedule', entityId: ev.id, summary: `"${ev.title}" added to ${ev.user.name}'s schedule by ${req.user.name}`, link: '/calendar' });
    return ev;
  });

  app.patch<{ Params: { id: string } }>('/schedule/:id', async (req) => {
    const ev = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: req.params.id } });
    if (ev.userId !== req.user.id && !isManager(req.user)) throw forbidden();
    const body = scheduleEventSchema.partial().parse(req.body);
    return prisma.scheduleEvent.update({
      where: { id: ev.id },
      data: {
        title: body.title,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        allDay: body.allDay,
        notes: body.notes,
      },
    });
  });

  app.delete<{ Params: { id: string } }>('/schedule/:id', async (req) => {
    const ev = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: req.params.id } });
    if (ev.userId !== req.user.id && !isManager(req.user)) throw forbidden();
    await prisma.scheduleEvent.delete({ where: { id: ev.id } });
    return { ok: true };
  });
}
