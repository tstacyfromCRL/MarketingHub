import { prisma } from '@mh/db';
import { recordEvent } from './activity';
import { bus } from './bus';
import { notify } from './notify';

/**
 * Creates a task on the team board the same way the Tasks screen does: logged, the assignee
 * notified, and every open client refreshed. Used by the prompt box and the assistant.
 */
export async function createBoardTask(input: {
  title: string;
  description?: string;
  assigneeId: string | null;
  dueDate: Date | null;
  stageName?: string;
  actorId: string;
  actorName: string;
  via?: string;
}) {
  const board = await prisma.board.findFirst({ orderBy: { id: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } });
  const wanted = (input.stageName ?? 'To Do').toLowerCase();
  const stage = board?.stages.find((row) => row.name.toLowerCase() === wanted) ?? board?.stages.find((row) => row.name.toLowerCase() === 'to do') ?? board?.stages[0];
  if (!board || !stage) throw new Error('The task board is not set up yet.');
  const last = await prisma.task.aggregate({ where: { stageId: stage.id }, _max: { order: true } });
  const task = await prisma.task.create({
    data: {
      boardId: board.id,
      stageId: stage.id,
      title: input.title,
      description: input.description ?? '',
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      creatorId: input.actorId,
      order: (last._max.order ?? 0) + 1000,
    },
    include: { assignee: { select: { id: true, name: true } }, stage: { select: { name: true } } },
  });
  await recordEvent({
    actorId: input.actorId,
    verb: 'create',
    entityType: 'task',
    entityId: task.id,
    link: `/tasks/${task.id}`,
    summary: `Task "${task.title}" created by ${input.actorName}${task.assignee ? ` and assigned to ${task.assignee.name}` : ''}${input.via ? ` ${input.via}` : ''}`,
  });
  if (task.assigneeId) {
    await notify([task.assigneeId], { title: 'New task assigned to you', body: `${input.actorName} assigned you "${task.title}".`, link: `/tasks/${task.id}` }, input.actorId);
  }
  bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
  return task;
}
