import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '@mh/db';
import {
  availableActions,
  isEditable,
  PLATFORMS,
  POST_ACTIONS,
  PLATFORM_PRESETS,
  postSchema,
  postTransitionSchema,
  postUpdateSchema,
  type Platform,
  type PostStatus,
} from '@mh/shared';
import {
  adaptCopyForPlatforms,
  applyPostAction,
  getDefaultOrgId,
  composeDesign,
  recordEvent,
  saveDesign,
  storage,
  verifyMediaSignature,
  mimeForKey,
  WorkflowError,
  bus,
} from '@mh/core';
import { authenticate, badRequest, forbidden, HttpError, notFound, type AuthUser } from '../http';

const graphicSchema = z.object({
  headline: z.string().min(1),
  subline: z.string().default(''),
  imagePrompt: z.string().optional(),
  productAssetId: z.string().optional(),
});

const createSchema = postSchema.extend({
  adaptCopy: z.boolean().default(true),
  graphic: graphicSchema.optional(),
});

const postInclude = {
  creator: { select: { id: true, name: true } },
  reviewer: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  design: { select: { id: true, name: true, previewKey: true, canvaDesignId: true } },
  variants: { include: { design: { select: { id: true, name: true, previewKey: true, canvaDesignId: true } } }, orderBy: { platform: 'asc' } },
} satisfies Prisma.PostInclude;

function ctxFor(user: AuthUser, post: { creatorId: string }) {
  return { role: user.role, isCreator: user.id === post.creatorId };
}

/** Builds one layered design per platform size (or one shared) for a post. */
async function buildGraphics(user: AuthUser, title: string, platforms: Platform[], perPlatform: boolean, g: z.infer<typeof graphicSchema>) {
  let productImageKey: string | undefined;
  if (g.productAssetId) {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: g.productAssetId } });
    if (asset.notForPublicUse) throw badRequest('That library file is not for public use.');
    productImageKey = asset.storedKey ?? asset.thumbnailKey ?? undefined;
  }
  const map = new Map<Platform, string>();
  let backgroundKey: string | undefined;
  for (const p of perPlatform ? platforms : [platforms[0]]) {
    const composed = await composeDesign({ headline: g.headline, subline: g.subline, platform: p, imagePrompt: g.imagePrompt, productImageKey, backgroundKey });
    backgroundKey ??= composed.backgroundKey;
    const d = await saveDesign({ name: `${title} - ${PLATFORM_PRESETS[p].label}`, doc: composed.doc, userId: user.id });
    map.set(p, d.id);
  }
  return map;
}

export async function postRoutes(app: FastifyInstance) {
  /** Signed, unauthenticated media URLs for platforms that fetch images themselves (Instagram, TikTok). */
  app.get<{ Params: { '*': string }; Querystring: { exp: string; sig: string } }>('/public/media/*', async (req, reply) => {
    const key = req.params['*'];
    if (!verifyMediaSignature(key, Number(req.query.exp), req.query.sig ?? '')) throw new HttpError(403, 'Link expired');
    reply.header('Content-Type', mimeForKey(key));
    return reply.send(await storage.get(key));
  });

  app.register(async (auth) => {
    auth.addHook('preHandler', authenticate);

    auth.get<{ Querystring: { status?: string; campaignId?: string; mine?: string; from?: string; to?: string } }>('/posts', async (req) => {
      const statuses = req.query.status?.split(',').filter(Boolean);
      return prisma.post.findMany({
        where: {
          status: statuses?.length ? { in: statuses as PostStatus[] } : undefined,
          campaignId: req.query.campaignId || undefined,
          creatorId: req.query.mine ? req.user.id : undefined,
          scheduledAt: req.query.from || req.query.to ? { gte: req.query.from ? new Date(req.query.from) : undefined, lte: req.query.to ? new Date(req.query.to) : undefined } : undefined,
        },
        include: postInclude,
        orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 300,
      });
    });

    auth.get<{ Params: { id: string } }>('/posts/:id', async (req) => {
      const post = await prisma.post.findUnique({ where: { id: req.params.id }, include: postInclude });
      if (!post) throw notFound('Post not found');
      const ctx = ctxFor(req.user, post);
      const history = await prisma.activityEvent.findMany({
        where: { entityType: 'post', entityId: post.id },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return { ...post, actions: availableActions(post.status as PostStatus, ctx), editable: isEditable(post.status as PostStatus, ctx), history };
    });

    /** Ad hoc post: optional AI graphics per platform size and per-platform copy. */
    auth.post('/posts', async (req) => {
      const body = createSchema.parse(req.body);
      const platforms = body.platforms as Platform[];
      const adapted = body.adaptCopy ? await adaptCopyForPlatforms(await getDefaultOrgId(), body.body, platforms) : { variants: Object.fromEntries(platforms.map((p) => [p, body.body])), warnings: {} as Record<string, { code: string; message: string }[]> };
      const copy = adapted.variants;
      const designs = body.graphic ? await buildGraphics(req.user, body.title, platforms, body.perPlatformFiles, body.graphic) : new Map<Platform, string>();
      const shared = designs.get(platforms[0]) ?? body.designId ?? null;
      const post = await prisma.post.create({
        data: {
          title: body.title,
          body: body.body,
          platforms,
          perPlatformFiles: body.perPlatformFiles,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          designId: shared,
          creatorId: req.user.id,
          aiWarnings: (body.aiWarnings ?? []) as Prisma.InputJsonValue,
          variants: { create: platforms.map((p) => ({ platform: p, body: copy[p], aiWarnings: (adapted.warnings[p] ?? []) as Prisma.InputJsonValue, designId: designs.get(p) ?? shared })) },
        },
        include: postInclude,
      });
      await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'post', entityId: post.id, summary: `Post "${post.title}" created by ${req.user.name}`, link: `/posts/${post.id}` });
      bus.publish({ userId: '*', type: 'post', payload: { id: post.id, status: post.status } });
      return post;
    });

    auth.patch<{ Params: { id: string } }>('/posts/:id', async (req) => {
      const body = postUpdateSchema.parse(req.body);
      const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id }, include: { variants: true } });
      const ctx = ctxFor(req.user, post);
      if (!isEditable(post.status as PostStatus, ctx)) {
        throw forbidden(post.status === 'IN_REVIEW' ? 'Only managers can edit a post under review' : 'This post can no longer be edited. Unschedule it first.');
      }
      const platforms = (body.platforms ?? post.platforms) as Platform[];
      await prisma.$transaction(async (tx) => {
        await tx.post.update({
          where: { id: post.id },
          data: {
            title: body.title,
            body: body.body,
            platforms: body.platforms,
            perPlatformFiles: body.perPlatformFiles,
            designId: body.designId,
            scheduledAt: body.scheduledAt === undefined ? undefined : body.scheduledAt ? new Date(body.scheduledAt) : null,
          },
        });
        if (body.platforms) {
          await tx.postVariant.deleteMany({ where: { postId: post.id, platform: { notIn: platforms } } });
          for (const p of platforms) {
            if (!post.variants.some((v) => v.platform === p)) {
              await tx.postVariant.create({ data: { postId: post.id, platform: p, body: body.body ?? post.body, designId: body.designId ?? post.designId } });
            }
          }
        }
        for (const v of body.variants ?? []) {
          await tx.postVariant.update({
            where: { postId_platform: { postId: post.id, platform: v.platform } },
            data: { body: v.body.slice(0, PLATFORM_PRESETS[v.platform].maxChars), designId: v.designId },
          });
        }
      });
      if (post.status === 'IN_REVIEW') {
        await applyPostAction(post.id, 'managerEdit', req.user);
      } else {
        await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'post', entityId: post.id, summary: `Post "${body.title ?? post.title}" edited by ${req.user.name}`, link: `/posts/${post.id}` });
      }
      return prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: postInclude });
    });

    /** Regenerates per-platform copy from the base copy. */
    auth.post<{ Params: { id: string } }>('/posts/:id/adapt', async (req) => {
      const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
      if (!isEditable(post.status as PostStatus, ctxFor(req.user, post))) throw forbidden('This post can no longer be edited');
      const copy = await adaptCopyForPlatforms(await getDefaultOrgId(), post.body, post.platforms as Platform[]);
      for (const [platform, body] of Object.entries(copy.variants)) {
        await prisma.postVariant.update({ where: { postId_platform: { postId: post.id, platform } }, data: { body, aiWarnings: (copy.warnings[platform] ?? []) as unknown as Prisma.InputJsonValue } });
      }
      return prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: postInclude });
    });

    auth.post<{ Params: { id: string } }>('/posts/:id/graphics', async (req) => {
      const g = graphicSchema.parse(req.body);
      const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
      if (!isEditable(post.status as PostStatus, ctxFor(req.user, post))) throw forbidden('This post can no longer be edited');
      const designs = await buildGraphics(req.user, post.title, post.platforms as Platform[], post.perPlatformFiles, g);
      const shared = designs.get(post.platforms[0] as Platform) ?? null;
      await prisma.post.update({ where: { id: post.id }, data: { designId: shared } });
      for (const p of post.platforms) {
        await prisma.postVariant.update({ where: { postId_platform: { postId: post.id, platform: p } }, data: { designId: designs.get(p as Platform) ?? shared } });
      }
      return prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: postInclude });
    });

    auth.post<{ Params: { id: string } }>('/posts/:id/transition', async (req) => {
      const body = postTransitionSchema.parse(req.body);
      try {
        await applyPostAction(req.params.id, body.action, req.user, { note: body.note, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined });
      } catch (err) {
        if (err instanceof WorkflowError) throw badRequest(err.message);
        throw err;
      }
      return prisma.post.findUniqueOrThrow({ where: { id: req.params.id }, include: postInclude });
    });

    /** Bulk actions, e.g. a creator approving every draft of a generated campaign at once. */
    auth.post('/posts/bulk-transition', async (req) => {
      const body = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(POST_ACTIONS) }).parse(req.body);
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const id of body.ids) {
        try {
          await applyPostAction(id, body.action, req.user);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: (err as Error).message });
        }
      }
      return { results };
    });

    auth.delete<{ Params: { id: string } }>('/posts/:id', async (req) => {
      const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
      if (post.status === 'SCHEDULED' || post.status === 'POSTED') throw badRequest('Unschedule the post before deleting it');
      if (post.creatorId !== req.user.id && !['ADMIN', 'MANAGER'].includes(req.user.role)) throw forbidden();
      await prisma.post.delete({ where: { id: post.id } });
      await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'post', entityId: post.id, summary: `Post "${post.title}" deleted by ${req.user.name}` });
      bus.publish({ userId: '*', type: 'post', payload: { id: post.id, deleted: true } });
      return { ok: true };
    });

    auth.get('/platforms', async () => PLATFORMS.map((p) => PLATFORM_PRESETS[p]));
  });
}
