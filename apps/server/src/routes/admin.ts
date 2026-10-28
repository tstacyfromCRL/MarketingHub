import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { config, expectedEmbedDims, localModelHealth, recordEvent, storedEmbedDims, usingRedis } from '@mh/core';
import { authenticate, requireRole } from '../http';

function weekKey(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x.toISOString().slice(0, 10);
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- Analytics ----
  app.get<{ Querystring: { days?: string } }>('/analytics', async (req) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 90), 7), 365);
    const since = new Date(Date.now() - days * 86_400_000);
    const [posts, variants, approvals, doneStage, users] = await Promise.all([
      prisma.post.findMany({ where: { createdAt: { gte: since } }, select: { id: true, status: true, creatorId: true, createdAt: true, postedAt: true } }),
      prisma.postVariant.findMany({ where: { post: { createdAt: { gte: since } } }, select: { platform: true, status: true } }),
      prisma.activityEvent.findMany({ where: { entityType: 'post', verb: { in: ['creatorApprove', 'approve'] }, createdAt: { gte: since } }, select: { entityId: true, verb: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.stage.findFirst({ orderBy: { order: 'desc' } }),
      prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    const tasksDone = doneStage
      ? await prisma.activityEvent.findMany({ where: { entityType: 'task', verb: 'move', createdAt: { gte: since }, summary: { contains: `to ${doneStage.name} by` } }, select: { createdAt: true, actorId: true } })
      : [];

    const byStatus: Record<string, number> = {};
    for (const p of posts) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

    const byPlatform: Record<string, { posted: number; failed: number; pending: number }> = {};
    for (const v of variants) {
      const b = (byPlatform[v.platform] ??= { posted: 0, failed: 0, pending: 0 });
      if (v.status === 'POSTED') b.posted++;
      else if (v.status === 'FAILED') b.failed++;
      else b.pending++;
    }

    const weekly: Record<string, { created: number; posted: number; tasksDone: number }> = {};
    const bump = (d: Date, k: 'created' | 'posted' | 'tasksDone') => {
      const w = (weekly[weekKey(d)] ??= { created: 0, posted: 0, tasksDone: 0 });
      w[k]++;
    };
    for (const p of posts) {
      bump(p.createdAt, 'created');
      if (p.postedAt) bump(p.postedAt, 'posted');
    }
    for (const t of tasksDone) bump(t.createdAt, 'tasksDone');

    // Review turnaround: time from creator approval to manager approval, per post.
    const submitted = new Map<string, Date>();
    const turnaroundHours: number[] = [];
    for (const e of approvals) {
      if (e.verb === 'creatorApprove') submitted.set(e.entityId, e.createdAt);
      else if (submitted.has(e.entityId)) turnaroundHours.push((e.createdAt.getTime() - submitted.get(e.entityId)!.getTime()) / 3_600_000);
    }
    turnaroundHours.sort((a, b) => a - b);

    const names = new Map(users.map((u) => [u.id, u.name]));
    const perCreator: Record<string, number> = {};
    for (const p of posts) perCreator[p.creatorId] = (perCreator[p.creatorId] ?? 0) + 1;

    return {
      days,
      totals: { posts: posts.length, posted: byStatus.POSTED ?? 0, failed: byStatus.FAILED ?? 0, tasksCompleted: tasksDone.length },
      byStatus,
      byPlatform,
      weekly: Object.entries(weekly).sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
      reviewTurnaround: {
        count: turnaroundHours.length,
        medianHours: turnaroundHours.length ? turnaroundHours[Math.floor(turnaroundHours.length / 2)] : null,
        averageHours: turnaroundHours.length ? turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length : null,
      },
      topCreators: Object.entries(perCreator).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => ({ id, name: names.get(id) ?? 'Unknown', count })),
    };
  });

  // ---- Global search ----
  app.get<{ Querystring: { q: string } }>('/search', async (req) => {
    const q = req.query.q?.trim();
    if (!q || q.length < 2) return { posts: [], tasks: [], products: [], assets: [], content: [], sources: [], campaigns: [] };
    const like = { contains: q, mode: 'insensitive' as const };
    const [posts, tasks, products, assets, content, sources, campaigns] = await Promise.all([
      prisma.post.findMany({ where: { OR: [{ title: like }, { body: like }] }, select: { id: true, title: true, status: true, scheduledAt: true }, take: 10 }),
      prisma.task.findMany({ where: { active: true, OR: [{ title: like }, { description: like }] }, select: { id: true, title: true, stage: { select: { name: true } } }, take: 10 }),
      prisma.product.findMany({ where: { OR: [{ name: like }, { sku: like }, { description: like }] }, select: { id: true, name: true, sku: true }, take: 10 }),
      prisma.asset.findMany({ where: { missing: false, OR: [{ relPath: like }, { description: like }, { tags: { has: q.toLowerCase() } }] }, select: { id: true, relPath: true, thumbnailKey: true }, take: 12 }),
      prisma.contentDoc.findMany({ where: { OR: [{ title: like }, { body: like }] }, select: { id: true, title: true, type: true }, take: 10 }),
      prisma.source.findMany({ where: { OR: [{ title: like }, { url: like }, { content: like }] }, select: { id: true, title: true, url: true }, take: 10 }),
      prisma.campaign.findMany({ where: { OR: [{ name: like }, { brief: like }] }, select: { id: true, name: true }, take: 10 }),
    ]);
    return { posts, tasks, products, assets, content, sources, campaigns };
  });

  // ---- System status (admin) ----
  app.get('/admin/system', { preHandler: requireRole('ADMIN') }, async () => {
    const [local, stored] = await Promise.all([localModelHealth(), storedEmbedDims()]);
    const expected = expectedEmbedDims();
    return {
      jobs: usingRedis ? 'redis' : 'in-process',
      storage: config.STORAGE_DRIVER,
      ai: {
        text: config.AI_TEXT_PROVIDER,
        image: config.AI_IMAGE_PROVIDER,
        embeddings: config.AI_EMBED_PROVIDER,
        vision: config.AI_VISION_PROVIDER,
        imageEmbeddings: config.IMAGE_EMBED_PROVIDER,
      },
      local,
      embedDims: { expected, stored, mismatch: stored.some((dims) => dims !== expected) },
      email: Boolean(config.SMTP_URL),
      slack: Boolean(config.SLACK_BOT_TOKEN),
      publishMode: config.PUBLISH_MODE,
      teamTimezone: config.TEAM_TIMEZONE,
    };
  });

  /**
   * JSON export of all app data (no password hashes or social tokens), for archiving or audits.
   * Full disaster-recovery backups should use pg_dump plus the object storage bucket.
   */
  app.get('/admin/backup', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const [users, quickLinks, boards, stages, categories, tasks, activity, schedule, brand, brandFiles, products, accomplishments, sources, assets, assetProducts, contentDocs, designs, campaigns, posts, variants, socialAccounts] =
      await Promise.all([
        prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, slackUserId: true, createdAt: true } }),
        prisma.quickLink.findMany(),
        prisma.board.findMany(),
        prisma.stage.findMany(),
        prisma.taskCategory.findMany(),
        prisma.task.findMany({ include: { categories: { select: { id: true } } } }),
        prisma.activityEvent.findMany({ orderBy: { createdAt: 'asc' } }),
        prisma.scheduleEvent.findMany(),
        prisma.brandProfile.findMany(),
        prisma.brandFile.findMany(),
        prisma.product.findMany(),
        prisma.accomplishment.findMany(),
        prisma.source.findMany(),
        prisma.asset.findMany(),
        prisma.assetProduct.findMany(),
        prisma.contentDoc.findMany(),
        prisma.design.findMany(),
        prisma.campaign.findMany(),
        prisma.post.findMany(),
        prisma.postVariant.findMany(),
        prisma.socialAccount.findMany({ select: { id: true, platform: true, displayName: true, externalId: true, createdAt: true } }),
      ]);
    await recordEvent({ actorId: req.user.id, verb: 'backup', entityType: 'system', entityId: 'backup', summary: `Data export downloaded by ${req.user.name}` });
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="mantis-export-${stamp}.json"`);
    return reply.send(
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        version: 1,
        data: { users, quickLinks, boards, stages, categories, tasks, activity, schedule, brand, brandFiles, products, accomplishments, sources, assets, assetProducts, contentDocs, designs, campaigns, posts, variants, socialAccounts },
      }),
    );
  });
}
