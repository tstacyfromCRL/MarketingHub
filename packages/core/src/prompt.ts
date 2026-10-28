import { prisma, type Prisma } from '@mh/db';
import { PLATFORM_PRESETS } from '@mh/shared';
import { bus } from './bus';
import { generateContent } from './generation';
import { notify } from './notify';
import { recordEvent } from './activity';
import { generateText } from './ai/providers';
import { intentFromModel, interpretPrompt, resolveWhen, withFollowUp, type Person, type PromptIntent } from './promptIntent';

export interface WorkflowPromptResult {
  reply: string;
  link?: string;
  linkLabel?: string;
  /** The sentence was incomplete. The next message should be sent back with this context. */
  needsDetail: boolean;
  context?: string;
}

/**
 * Turns one plain-language sentence into a draft or a task.
 * A draft is never approved or published from here.
 */
export async function runWorkflowPrompt(input: { message: string; context?: string; actorId: string; actorName: string }): Promise<WorkflowPromptResult> {
  const combined = input.context ? withFollowUp(input.context, input.message) : input.message.trim();
  const people = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  let intent = interpretPrompt(combined, people);
  if (intent.kind === 'unknown') {
    try {
      intent = await interpretWithModel(combined, people);
    } catch (err) {
      return { reply: (err as Error).message || 'The language model could not read that sentence.', needsDetail: false };
    }
  }

  if (intent.kind === 'unknown') {
    return { reply: 'I can start a draft or a task. Tell me the network and the subject, or who the task is for.', needsDetail: true, context: combined };
  }
  if (intent.kind === 'clarify') return { reply: intent.question, needsDetail: true, context: combined };
  if (intent.kind === 'refuse') return { reply: intent.message, needsDetail: false };
  try {
    if (intent.kind === 'task') return await createTask(intent, input.actorId, input.actorName);
    return await createDraft(intent, input.actorId, input.actorName);
  } catch (err) {
    return { reply: (err as Error).message || 'That did not go through.', needsDetail: false };
  }
}

async function interpretWithModel(text: string, people: Person[]): Promise<PromptIntent> {
  const names = people.map((person) => person.name).join(', ') || '(no teammates yet)';
  const raw = await generateText({
    system: [
      'You turn a marketing teammate\'s sentence into one JSON object.',
      'Allowed actions are create-post, create-task, clarify, and refuse.',
      'create-post needs platform (linkedin, facebook, instagram, x, tiktok, youtube) and brief.',
      'create-task needs title. assignee is a name from the team list, or empty.',
      'when is today, tomorrow, next week, or null.',
      'Use refuse for publish, approve, delete, or archive. Use clarify when a name or network is missing.',
      'Do not invent a person who is not on the team.',
      `Team: ${names}.`,
    ].join(' '),
    prompt: text,
    json: true,
    maxTokens: 300,
    mock: () => JSON.stringify({ action: 'clarify', question: 'I can start a draft or a task. Tell me the network and the subject, or who the task is for.' }),
  });
  return intentFromModel(raw, people);
}

async function createTask(intent: Extract<PromptIntent, { kind: 'task' }>, actorId: string, actorName: string): Promise<WorkflowPromptResult> {
  const board = await prisma.board.findFirst({ orderBy: { id: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } });
  const stage = board?.stages.find((row) => row.name.toLowerCase() === 'to do') ?? board?.stages[0];
  if (!board || !stage) return { reply: 'The task board is not set up yet.', needsDetail: false };
  const due = resolveWhen(intent.when, new Date());
  const last = await prisma.task.aggregate({ where: { stageId: stage.id }, _max: { order: true } });
  const task = await prisma.task.create({
    data: {
      boardId: board.id,
      stageId: stage.id,
      title: intent.title,
      description: '',
      assigneeId: intent.assigneeId,
      dueDate: due,
      creatorId: actorId,
      order: (last._max.order ?? 0) + 1000,
    },
  });
  await recordEvent({
    actorId,
    verb: 'create',
    entityType: 'task',
    entityId: task.id,
    link: `/tasks/${task.id}`,
    summary: `Task "${task.title}" created by ${actorName}${intent.assigneeName ? ` and assigned to ${intent.assigneeName}` : ''} from a prompt`,
  });
  if (intent.assigneeId) {
    await notify([intent.assigneeId], { title: 'New task assigned to you', body: `${actorName} assigned you "${task.title}".`, link: `/tasks/${task.id}` }, actorId);
  }
  bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
  const who = intent.assigneeName ? ` for ${intent.assigneeName}` : '';
  const when = due ? `, due ${formatWhen(due)}` : '';
  return { reply: `Created a task${who}${when}: ${task.title}. It is in To Do.`, link: `/tasks/${task.id}`, linkLabel: 'Open the task', needsDetail: false };
}

async function createDraft(intent: Extract<PromptIntent, { kind: 'post' }>, actorId: string, actorName: string): Promise<WorkflowPromptResult> {
  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true } });
  const brief = intent.brief.toLowerCase();
  const productIds = products.filter((product) => product.name.length > 2 && brief.includes(product.name.toLowerCase())).map((product) => product.id);
  const generated = await generateContent({ type: 'SOCIAL_POST', brief: intent.brief, platform: intent.platform, productIds });
  const when = resolveWhen(intent.when, new Date());
  const label = PLATFORM_PRESETS[intent.platform].label;
  const post = await prisma.post.create({
    data: {
      title: `${label}: ${intent.brief}`.slice(0, 140),
      body: generated.text,
      platforms: [intent.platform],
      scheduledAt: when,
      creatorId: actorId,
      aiWarnings: generated.warnings as unknown as Prisma.InputJsonValue,
      variants: { create: [{ platform: intent.platform, body: generated.text.slice(0, PLATFORM_PRESETS[intent.platform].maxChars), aiWarnings: generated.warnings as unknown as Prisma.InputJsonValue }] },
    },
  });
  await recordEvent({
    actorId,
    verb: 'create',
    entityType: 'post',
    entityId: post.id,
    link: `/posts/${post.id}`,
    summary: `Draft "${post.title}" created by ${actorName} from a prompt`,
  });
  bus.publish({ userId: '*', type: 'post', payload: { id: post.id, status: post.status } });
  const aimed = when ? ` Aimed at ${formatWhen(when)}.` : '';
  return {
    reply: `Started a ${label} draft about ${intent.brief}.${aimed} It still needs approval before it can be scheduled.`,
    link: `/posts/${post.id}`,
    linkLabel: 'Open the draft',
    needsDetail: false,
  };
}

function formatWhen(date: Date): string {
  return date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
