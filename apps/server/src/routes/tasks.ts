import type { FastifyInstance } from 'fastify';
import { prisma } from '@mh/db';
import { categorySchema, stageReorderSchema, stageSchema, taskMoveSchema, taskSchema, taskUpdateSchema } from '@mh/shared';
import { bus, notify, recordEvent } from '@mh/core';
import { authenticate, badRequest, conflict, notFound, requireRole } from '../http';

const taskInclude = {
  categories: true,
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} as const;

async function defaultBoard() {
  const board = await prisma.board.findFirst({ orderBy: { id: 'asc' } });
  if (!board) throw notFound('No board has been set up');
  return board;
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/board', async () => {
    const board = await defaultBoard();
    const [stages, tasks, categories] = await Promise.all([
      prisma.stage.findMany({ where: { boardId: board.id }, orderBy: { order: 'asc' } }),
      prisma.task.findMany({ where: { boardId: board.id }, include: taskInclude, orderBy: { order: 'asc' } }),
      prisma.taskCategory.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return { board, stages, tasks, categories };
  });

  // ---- Stages: admin only (define, add, remove, reorder) ----
  app.post('/stages', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = stageSchema.parse(req.body);
    const board = await defaultBoard();
    const max = await prisma.stage.aggregate({ where: { boardId: board.id }, _max: { order: true } });
    const stage = await prisma.stage.create({ data: { ...body, boardId: board.id, order: (max._max.order ?? -1) + 1 } });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'stage', entityId: stage.id, summary: `Task stage "${stage.name}" added by ${req.user.name}`, link: '/tasks' });
    bus.publish({ userId: '*', type: 'task', payload: { board: true } });
    return stage;
  });

  app.patch<{ Params: { id: string } }>('/stages/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = stageSchema.partial().parse(req.body);
    const stage = await prisma.stage.update({ where: { id: req.params.id }, data: body });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'stage', entityId: stage.id, summary: `Task stage "${stage.name}" edited by ${req.user.name}`, link: '/tasks' });
    bus.publish({ userId: '*', type: 'task', payload: { board: true } });
    return stage;
  });

  app.put('/stages/order', { preHandler: requireRole('ADMIN') }, async (req) => {
    const { stageIds } = stageReorderSchema.parse(req.body);
    await prisma.$transaction(stageIds.map((id, i) => prisma.stage.update({ where: { id }, data: { order: i } })));
    bus.publish({ userId: '*', type: 'task', payload: { board: true } });
    return { ok: true };
  });

  /** Deleting a stage requires moving its tasks somewhere else first (?moveTo=stageId). */
  app.delete<{ Params: { id: string }; Querystring: { moveTo?: string } }>('/stages/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const stage = await prisma.stage.findUniqueOrThrow({ where: { id: req.params.id } });
    const count = await prisma.task.count({ where: { stageId: stage.id } });
    if (count > 0) {
      if (!req.query.moveTo || req.query.moveTo === stage.id) throw conflict(`"${stage.name}" still has ${count} task(s). Choose a stage to move them to.`);
      await prisma.task.updateMany({ where: { stageId: stage.id }, data: { stageId: req.query.moveTo } });
    }
    if ((await prisma.stage.count({ where: { boardId: stage.boardId } })) <= 1) throw badRequest('The board needs at least one stage');
    await prisma.stage.delete({ where: { id: stage.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'stage', entityId: stage.id, summary: `Task stage "${stage.name}" removed by ${req.user.name}`, link: '/tasks' });
    bus.publish({ userId: '*', type: 'task', payload: { board: true } });
    return { ok: true };
  });

  // ---- Categories: anyone may add/edit/remove ----
  app.post('/categories', async (req) => {
    const body = categorySchema.parse(req.body);
    const cat = await prisma.taskCategory.create({ data: body });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'category', entityId: cat.id, summary: `Task category "${cat.name}" added by ${req.user.name}`, link: '/tasks' });
    return cat;
  });
  app.patch<{ Params: { id: string } }>('/categories/:id', async (req) => prisma.taskCategory.update({ where: { id: req.params.id }, data: categorySchema.partial().parse(req.body) }));
  app.delete<{ Params: { id: string } }>('/categories/:id', async (req) => {
    const cat = await prisma.taskCategory.delete({ where: { id: req.params.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'category', entityId: cat.id, summary: `Task category "${cat.name}" removed by ${req.user.name}`, link: '/tasks' });
    return { ok: true };
  });

  // ---- Tasks ----
  app.post('/tasks', async (req) => {
    const body = taskSchema.parse(req.body);
    const board = await defaultBoard();
    const last = await prisma.task.aggregate({ where: { stageId: body.stageId }, _max: { order: true } });
    const task = await prisma.task.create({
      data: {
        boardId: board.id,
        stageId: body.stageId,
        title: body.title,
        description: body.description,
        assigneeId: body.assigneeId,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        creatorId: req.user.id,
        order: (last._max.order ?? 0) + 1000,
        categories: { connect: body.categoryIds.map((id) => ({ id })) },
      },
      include: taskInclude,
    });
    await recordEvent({
      actorId: req.user.id, verb: 'create', entityType: 'task', entityId: task.id, link: `/tasks/${task.id}`,
      summary: `Task "${task.title}" created by ${req.user.name}${task.assignee ? ` and assigned to ${task.assignee.name}` : ''}`,
    });
    if (task.assigneeId) await notify([task.assigneeId], { title: 'New task assigned to you', body: `${req.user.name} assigned you "${task.title}".`, link: `/tasks/${task.id}` }, req.user.id);
    bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
    return task;
  });

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    const body = taskUpdateSchema.parse(req.body);
    const before = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id }, include: { stage: true } });
    const task = await prisma.task.update({
      where: { id: before.id },
      data: {
        title: body.title,
        description: body.description,
        stageId: body.stageId,
        assigneeId: body.assigneeId,
        dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
        categories: body.categoryIds ? { set: body.categoryIds.map((id) => ({ id })) } : undefined,
      },
      include: { ...taskInclude, stage: true },
    });
    const changes: string[] = [];
    if (body.assigneeId !== undefined && body.assigneeId !== before.assigneeId) changes.push(task.assignee ? `assigned to ${task.assignee.name}` : 'unassigned');
    if (body.stageId && body.stageId !== before.stageId) changes.push(`moved to ${task.stage.name}`);
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'task', entityId: task.id, link: `/tasks/${task.id}`, summary: `Task "${task.title}" updated by ${req.user.name}${changes.length ? ` (${changes.join(', ')})` : ''}` });
    if (body.assigneeId && body.assigneeId !== before.assigneeId) {
      await notify([body.assigneeId], { title: 'Task assigned to you', body: `${req.user.name} assigned you "${task.title}".`, link: `/tasks/${task.id}` }, req.user.id);
    }
    bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
    return task;
  });

  /** Drag-and-drop: move to a stage at a fractional order position. */
  app.put<{ Params: { id: string } }>('/tasks/:id/move', async (req) => {
    const body = taskMoveSchema.parse(req.body);
    const before = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id }, include: { stage: true } });
    const task = await prisma.task.update({ where: { id: before.id }, data: { stageId: body.stageId, order: body.order }, include: { ...taskInclude, stage: true } });
    if (before.stageId !== body.stageId) {
      await recordEvent({ actorId: req.user.id, verb: 'move', entityType: 'task', entityId: task.id, link: `/tasks/${task.id}`, summary: `Task "${task.title}" moved from ${before.stage.name} to ${task.stage.name} by ${req.user.name}` });
      await notify([task.creatorId, task.assigneeId], { title: `Task moved to ${task.stage.name}`, body: `${req.user.name} moved "${task.title}".`, link: `/tasks/${task.id}` }, req.user.id);
    }
    bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
    return task;
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    const task = await prisma.task.delete({ where: { id: req.params.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'task', entityId: task.id, summary: `Task "${task.title}" deleted by ${req.user.name}`, link: '/tasks' });
    bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
    return { ok: true };
  });
}
