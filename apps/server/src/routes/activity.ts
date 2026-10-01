import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { authenticate } from '../http';

export async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Work log, newest first, with cursor pagination and filters. */
  app.get<{ Querystring: { cursor?: string; entityType?: string; actorId?: string; q?: string; from?: string; to?: string; limit?: string } }>(
    '/activity',
    async (req) => {
      const { cursor, entityType, actorId, q, from, to } = req.query;
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const events = await prisma.activityEvent.findMany({
        where: {
          entityType: entityType || undefined,
          actorId: actorId || undefined,
          summary: q ? { contains: q, mode: 'insensitive' } : undefined,
          createdAt: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
        },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = events.length > limit;
      const items = hasMore ? events.slice(0, limit) : events;
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    },
  );
}
