import type { FastifyInstance } from 'fastify';
import { mimeForKey, storage } from '@mh/core';
import { authenticate, notFound } from '../http';

export async function fileRoutes(app: FastifyInstance) {
  /** Streams a stored object. Accepts ?token= so it can be used directly in <img src>. */
  app.get<{ Params: { '*': string }; Querystring: { download?: string; name?: string } }>(
    '/files/*',
    { preHandler: authenticate },
    async (req, reply) => {
      const key = req.params['*'];
      let body: Buffer;
      try {
        body = await storage.get(key);
      } catch {
        throw notFound('File not found');
      }
      reply.header('Content-Type', mimeForKey(key));
      reply.header('Cache-Control', 'private, max-age=3600');
      if (req.query.download) {
        const name = (req.query.name ?? key.split('/').pop() ?? 'file').replace(/[^\w.\- ]/g, '_');
        reply.header('Content-Disposition', `attachment; filename="${name}"`);
      }
      return reply.send(body);
    },
  );
}
