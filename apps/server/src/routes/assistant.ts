import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assistantStatus, deleteAssistantThread, getAssistantThread, listAssistantThreads, runAssistantTurn } from '@mh/core';
import { authenticate, notFound } from '../http';

const messageSchema = z.object({
  threadId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).max(8000),
  /** The screen the person has open, such as /posts/abc, so "this post" can be resolved. */
  page: z.string().trim().max(300).optional(),
});

/** The chat assistant. Conversations belong to the person who started them. */
export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/assistant/status', async () => assistantStatus());

  app.get('/assistant/threads', async (req) => listAssistantThreads(req.user.id));

  app.get<{ Params: { id: string } }>('/assistant/threads/:id', async (req) => {
    const thread = await getAssistantThread(req.user.id, req.params.id);
    if (!thread) throw notFound('Conversation not found');
    return thread;
  });

  app.delete<{ Params: { id: string } }>('/assistant/threads/:id', async (req) => {
    if (!(await deleteAssistantThread(req.user.id, req.params.id))) throw notFound('Conversation not found');
    return { ok: true };
  });

  app.post('/assistant/messages', async (req) => {
    const body = messageSchema.parse(req.body);
    try {
      return await runAssistantTurn({
        userId: req.user.id,
        threadId: body.threadId,
        message: body.message,
        page: body.page,
        actor: { id: req.user.id, name: req.user.name, role: req.user.role },
      });
    } catch (err) {
      if ((err as Error).message === 'That conversation was not found.') throw notFound('Conversation not found');
      throw err;
    }
  });
}
