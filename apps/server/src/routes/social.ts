import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { PLATFORMS, PLATFORM_PRESETS, type Platform } from '@mh/shared';
import { completeOAuth, config, oauthClient, recordEvent, startOAuth } from '@mh/core';
import { authenticate, badRequest, requireRole } from '../http';

const page = (title: string, message: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}div{max-width:480px;text-align:center}h1{font-size:22px}</style></head><body><div><h1>${title}</h1><p>${message}</p><p>You can close this window and return to Marketing Hub.</p></div></body></html>`;

export async function socialRoutes(app: FastifyInstance) {
  /** OAuth redirect target (opened in the user's browser, so no bearer token). */
  app.get<{ Params: { platform: string }; Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/social/callback/:platform',
    async (req, reply) => {
      reply.type('text/html');
      const platform = req.params.platform as Platform;
      if (req.query.error || !req.query.code || !req.query.state) {
        return page('Connection cancelled', req.query.error_description ?? req.query.error ?? 'No authorization code was returned.');
      }
      try {
        const { accounts, userId } = await completeOAuth(platform, req.query.code, req.query.state);
        const user = await prisma.user.findUnique({ where: { id: userId } });
        await recordEvent({ actorId: userId, verb: 'connect', entityType: 'social', entityId: platform, summary: `${PLATFORM_PRESETS[platform]?.label ?? platform} connected by ${user?.name ?? 'a user'} (${accounts.length} account${accounts.length === 1 ? '' : 's'})`, link: '/settings/social' });
        return page('Connected', accounts.length ? `Connected: ${accounts.join(', ')}` : 'No postable accounts were found for this login.');
      } catch (err) {
        req.log.error(err);
        return page('Connection failed', (err as Error).message);
      }
    },
  );

  app.register(async (auth) => {
    auth.addHook('preHandler', authenticate);

    auth.get('/social/platforms', async () =>
      PLATFORMS.map((p) => ({ ...PLATFORM_PRESETS[p], configured: Boolean(oauthClient(p)), publishMode: config.PUBLISH_MODE })),
    );

    auth.get('/social/accounts', async () => {
      const [accounts, defaults] = await Promise.all([
        prisma.socialAccount.findMany({
          select: { id: true, platform: true, displayName: true, externalId: true, expiresAt: true, createdAt: true, connectedBy: { select: { id: true, name: true } } },
          orderBy: [{ platform: 'asc' }, { displayName: 'asc' }],
        }),
        prisma.appSetting.findUnique({ where: { key: 'defaultAccounts' } }),
      ]);
      return { accounts, defaults: (defaults?.value as Record<string, string>) ?? {} };
    });

    /** Returns the provider's login URL; the desktop app opens it in the system browser. */
    auth.post<{ Params: { platform: string } }>('/social/connect/:platform', { preHandler: requireRole('MANAGER') }, async (req) => {
      const platform = req.params.platform as Platform;
      if (!PLATFORMS.includes(platform)) throw badRequest('Unknown platform');
      try {
        return { url: await startOAuth(platform, req.user.id) };
      } catch (err) {
        throw badRequest((err as Error).message);
      }
    });

    auth.put('/social/defaults', { preHandler: requireRole('MANAGER') }, async (req) => {
      const body = z.record(z.string()).parse(req.body);
      await prisma.appSetting.upsert({ where: { key: 'defaultAccounts' }, update: { value: body }, create: { key: 'defaultAccounts', value: body } });
      return { ok: true };
    });

    auth.delete<{ Params: { id: string } }>('/social/accounts/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
      const a = await prisma.socialAccount.delete({ where: { id: req.params.id } });
      await recordEvent({ actorId: req.user.id, verb: 'disconnect', entityType: 'social', entityId: a.id, summary: `${PLATFORM_PRESETS[a.platform as Platform]?.label ?? a.platform} account "${a.displayName}" disconnected by ${req.user.name}`, link: '/settings/social' });
      return { ok: true };
    });
  });
}
