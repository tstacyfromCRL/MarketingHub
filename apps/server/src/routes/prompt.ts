import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runWorkflowPrompt } from '@mh/core';
import { authenticate } from '../http';

const promptSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  /** The earlier sentence, when the last reply asked for a missing name or network. */
  context: z.string().trim().max(4000).optional(),
});

/** One sentence at the bottom of the app. It can start a draft or a task, and nothing that sends or removes work. */
export async function promptRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/prompt', async (req) => {
    const body = promptSchema.parse(req.body);
    return runWorkflowPrompt({ message: body.message, context: body.context, actorId: req.user.id, actorName: req.user.name });
  });
}
