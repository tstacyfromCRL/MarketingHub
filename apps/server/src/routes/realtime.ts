import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { bus } from '@mh/core';

export async function realtimeRoutes(app: FastifyInstance) {
  /** Desktop clients connect with ws://host/ws?token=<jwt> to receive notifications and live updates. */
  app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, async (socket, req) => {
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(req.query.token ?? '').sub;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.active) throw new Error('inactive');
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    const unsubscribe = bus.subscribe((msg) => {
      if (msg.userId === '*' || msg.userId === userId) {
        socket.send(JSON.stringify({ type: msg.type, payload: msg.payload }));
      }
    });
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
