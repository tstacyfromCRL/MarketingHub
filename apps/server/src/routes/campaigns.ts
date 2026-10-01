import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { campaignSchema, planCampaignSlots } from '@mh/shared';
import { enqueue, MAX_CAMPAIGN_POSTS, recordEvent } from '@mh/core';
import { authenticate, badRequest, forbidden, isManager } from '../http';

export async function campaignRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/campaigns', async () => {
    const campaigns = await prisma.campaign.findMany({
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { posts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await prisma.post.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { not: null } }, _count: true });
    return campaigns.map((c) => ({
      ...c,
      statusCounts: Object.fromEntries(counts.filter((x) => x.campaignId === c.id).map((x) => [x.status, x._count])),
    }));
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (req) =>
    prisma.campaign.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        posts: {
          include: { variants: { include: { design: { select: { id: true, previewKey: true } } } }, design: { select: { id: true, previewKey: true } } },
          orderBy: { scheduledAt: 'asc' },
        },
      },
    }),
  );

  /** Previews how many posts the settings produce, before spending AI credits. */
  app.post('/campaigns/preview', async (req) => {
    const body = campaignSchema.parse(req.body);
    const slots = planCampaignSlots(body);
    return { count: slots.length, capped: slots.length > MAX_CAMPAIGN_POSTS, max: MAX_CAMPAIGN_POSTS, slots: slots.slice(0, MAX_CAMPAIGN_POSTS) };
  });

  app.post('/campaigns', async (req) => {
    const body = campaignSchema.parse(req.body);
    if (body.endDate < body.startDate) throw badRequest('The end date is before the start date');
    const count = planCampaignSlots(body).length;
    if (count === 0) throw badRequest('No posting days fall within these dates');
    const c = await prisma.campaign.create({
      data: {
        name: body.name,
        brief: body.brief,
        startDate: new Date(`${body.startDate}T00:00:00Z`),
        endDate: new Date(`${body.endDate}T00:00:00Z`),
        postDays: body.postDays,
        postTimes: body.postTimes,
        utcOffsetMinutes: body.utcOffsetMinutes,
        platforms: body.platforms,
        perPlatformFiles: body.perPlatformFiles,
        productIds: body.productIds,
        generateGraphics: body.generateGraphics,
        createdById: req.user.id,
      },
    });
    await enqueue('generate-campaign', { campaignId: c.id });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'campaign', entityId: c.id, summary: `Campaign "${c.name}" (${body.startDate} to ${body.endDate}, ${Math.min(count, MAX_CAMPAIGN_POSTS)} posts) started by ${req.user.name}`, link: `/campaigns/${c.id}` });
    return c;
  });

  app.delete<{ Params: { id: string }; Querystring: { withPosts?: string } }>('/campaigns/:id', async (req) => {
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: req.params.id } });
    if (c.createdById !== req.user.id && !isManager(req.user)) throw forbidden();
    if (req.query.withPosts) {
      const live = await prisma.post.count({ where: { campaignId: c.id, status: { in: ['SCHEDULED', 'POSTED'] } } });
      if (live) throw badRequest(`${live} post(s) are scheduled or posted. Unschedule them first, or delete the campaign without its posts.`);
      await prisma.post.deleteMany({ where: { campaignId: c.id } });
    }
    await prisma.campaign.delete({ where: { id: c.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'campaign', entityId: c.id, summary: `Campaign "${c.name}" deleted by ${req.user.name}` });
    return { ok: true };
  });
}
