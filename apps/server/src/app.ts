import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { Prisma } from '@mh/db';
import { config } from '@mh/core';
import { HttpError } from './http';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { libraryRoutes } from './routes/library';
import { fileRoutes } from './routes/files';
import { realtimeRoutes } from './routes/realtime';
import { dashboardRoutes } from './routes/dashboard';
import { taskRoutes } from './routes/tasks';
import { activityRoutes } from './routes/activity';
import { calendarRoutes } from './routes/calendar';
import { knowledgeRoutes } from './routes/knowledge';
import { assetRoutes } from './routes/assets';
import { generationRoutes } from './routes/generation';
import { designRoutes } from './routes/designs';
import { postRoutes } from './routes/posts';
import { campaignRoutes } from './routes/campaigns';
import { socialRoutes } from './routes/social';
import { adminRoutes } from './routes/admin';
import { onboardingRoutes } from './routes/onboarding';

(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 25 * 1024 * 1024 });

  await app.register(cors, { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await app.register(websocket);

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error;
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return reply.status(404).send({ error: 'Not found' });
      if (err.code === 'P2002') return reply.status(409).send({ error: 'That already exists' });
      if (err.code === 'P2003') return reply.status(409).send({ error: 'That item is still in use' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(libraryRoutes);
  await app.register(fileRoutes);
  await app.register(realtimeRoutes);
  await app.register(dashboardRoutes);
  await app.register(taskRoutes);
  await app.register(activityRoutes);
  await app.register(calendarRoutes);
  await app.register(knowledgeRoutes);
  await app.register(assetRoutes);
  await app.register(generationRoutes);
  await app.register(designRoutes);
  await app.register(postRoutes);
  await app.register(campaignRoutes);
  await app.register(socialRoutes);
  await app.register(adminRoutes);
  await app.register(onboardingRoutes);

  return app;
}
