import { prisma, type Prisma } from '@mh/db';
import { isEditable, POST_STATUS_LABELS, type PostStatus } from '@mh/shared';
import { assistantCanChat, assistantModelLabel, chatWithTools } from './ai/chat';
import { runAssistantLoop, transcriptTurns, type AssistantAction } from './assistantLoop';
import { ASSISTANT_TOOLS, executeAssistantTool, type AssistantActor } from './assistantTools';
import { config } from './config';
import { brandProfile } from './knowledge';
import { getDefaultOrgId } from './org';
import { runWorkflowPrompt } from './prompt';

export type { AssistantAction } from './assistantLoop';
export type { AssistantActor } from './assistantTools';

/** How much of a thread is replayed to the model. Older lines stay saved and visible. */
const HISTORY = 30;

export interface AssistantMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions: AssistantAction[];
  createdAt: Date;
}

function view(row: { id: string; role: string; content: string; actions: unknown; createdAt: Date }): AssistantMessageView {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    actions: Array.isArray(row.actions) ? (row.actions as AssistantAction[]) : [],
    createdAt: row.createdAt,
  };
}

export function assistantStatus() {
  return { conversational: assistantCanChat(), model: assistantModelLabel() };
}

export async function listAssistantThreads(userId: string) {
  return prisma.assistantThread.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 40, select: { id: true, title: true, updatedAt: true } });
}

export async function getAssistantThread(userId: string, threadId: string) {
  const thread = await prisma.assistantThread.findFirst({ where: { id: threadId, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!thread) return null;
  return { id: thread.id, title: thread.title, updatedAt: thread.updatedAt, messages: thread.messages.map(view) };
}

export async function deleteAssistantThread(userId: string, threadId: string): Promise<boolean> {
  const result = await prisma.assistantThread.deleteMany({ where: { id: threadId, userId } });
  return result.count > 0;
}

/** Plain-language note about the screen the person has open, so "this post" means something. */
export async function describePage(page: string | undefined, actor: AssistantActor): Promise<string> {
  if (!page) return '';
  const path = page.split('?')[0] ?? page;
  const postId = /^\/posts\/([\w-]+)/.exec(path)?.[1];
  if (postId) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return '';
    const editable = isEditable(post.status as PostStatus, { role: actor.role, isCreator: post.creatorId === actor.id });
    return [
      `The person has post ${post.id} open: "${post.title}" (${POST_STATUS_LABELS[post.status as PostStatus]}, ${editable ? 'they can edit it' : 'they cannot edit it'}).`,
      'When they say "this post" or "it", they mean this one.',
      `Current copy:\n${post.body.slice(0, 2000)}`,
      post.reviewNote ? `Manager's note on it: ${post.reviewNote}` : '',
    ].filter(Boolean).join('\n');
  }
  const taskId = /^\/tasks\/([\w-]+)/.exec(path)?.[1];
  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, include: { stage: true, assignee: { select: { name: true } } } });
    if (!task) return '';
    return `The person has task ${task.id} open: "${task.title}" in ${task.stage.name}${task.assignee ? `, assigned to ${task.assignee.name}` : ', unassigned'}${task.dueDate ? `, due ${task.dueDate.toISOString()}` : ''}. "This task" means this one.`;
  }
  const campaignId = /^\/campaigns\/([\w-]+)/.exec(path)?.[1];
  if (campaignId && campaignId !== 'new') {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { posts: { select: { id: true, title: true, status: true }, take: 20 } } });
    if (!campaign) return '';
    const posts = campaign.posts.map((p) => `- ${p.id}: "${p.title}" (${POST_STATUS_LABELS[p.status as PostStatus]})`).join('\n');
    return `The person has campaign "${campaign.name}" open. Its posts:\n${posts || '(none yet)'}`;
  }
  if (path === '/studio' && page.includes('tab=drafts')) return 'The person is looking at the drafts list in Content studio.';
  return `The person is on the ${path} screen.`;
}

function today(): { long: string; iso: string } {
  const now = new Date();
  const long = new Intl.DateTimeFormat('en-US', { timeZone: config.TEAM_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(now);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.TEAM_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { long, iso: parts };
}

export async function buildAssistantSystem(actor: AssistantActor, page?: string): Promise<string> {
  const orgId = await getDefaultOrgId();
  const [brand, people, terms, pageNote] = await Promise.all([
    brandProfile(orgId),
    prisma.user.findMany({ where: { active: true }, select: { name: true, role: true }, orderBy: { name: 'asc' } }),
    prisma.confidentialTerm.findMany({ where: { organizationId: orgId } }),
    describePage(page, actor),
  ]);
  const company = brand.companyName || 'the company';
  const now = today();
  const banned = terms.flatMap((t) => [t.term, ...t.aliases]).filter(Boolean);
  return [
    `You are Mantis, the AI teammate on the ${company} marketing team. You are talking with ${actor.name} (${actor.role.toLowerCase()}).`,
    'Act like a capable colleague, not a form: friendly, direct, and brief. Answer questions, think through ideas, and draft copy in the chat when asked. When the person wants something done in Mantis, do it with your tools instead of explaining how.',
    `Right now it is ${now.long} (${config.TEAM_TIMEZONE}). Today's date is ${now.iso}. Turn "Friday" or "next week" into real dates yourself.`,
    `Team: ${people.map((p) => `${p.name} (${p.role.toLowerCase()})`).join(', ') || 'no one yet'}.`,
    brand.summary && `About ${company}: ${brand.summary.slice(0, 800)}`,
    brand.voice && `Brand voice for anything you write: ${brand.voice}`,
    brand.audience && `Audience: ${brand.audience}`,
    banned.length ? `Never mention these names: ${banned.join(', ')}.` : '',
    [
      'How to work:',
      '- Tasks: before create_task, know what it is, who it is for, and when it is due. If the person left out who or when, ask one short question that covers what is missing, and offer "unassigned" or "no date" as answers. Do not ask again for anything they already said.',
      '- Never guess a teammate. If a name matches no one or more than one person, ask.',
      '- Posts: to change a post, call rewrite_post with the person\'s notes. If it is not clear which post, use the open page, or find_posts and confirm. After a rewrite, show the new copy in your reply.',
      '- New posts: create_post_draft needs the networks and what it is about. Ask if either is missing.',
      '- Use search_knowledge or list_products before stating product facts. Only use numbers and results that appear there.',
      '- You cannot approve, publish, schedule, unschedule, archive, or delete anything. Say those stay on their buttons in Mantis, and point to the screen.',
      '- After you do something, say what you did in a sentence or two. Links to what you made appear under your reply, so do not paste URLs or ids.',
    ].join('\n'),
    pageNote && `Context:\n${pageNote}`,
  ].filter(Boolean).join('\n\n');
}

/** Without an AI key the assistant falls back to the sentence rules: one draft or one task at a time. */
async function mockReply(message: string, context: string | undefined, actor: AssistantActor) {
  const result = await runWorkflowPrompt({ message, context, actorId: actor.id, actorName: actor.name });
  const actions: AssistantAction[] = result.link ? [{ kind: result.link.startsWith('/tasks') ? 'task' : 'post', label: result.linkLabel ?? 'Open it', link: result.link }] : [];
  const note = result.needsDetail ? '' : '\n\nAdd an OpenAI or Anthropic key on the server to talk with me about anything else.';
  return { text: `${result.reply}${note}`, actions, context: result.needsDetail ? result.context : undefined };
}

/** One message from the person, and Mantis's reply, saved to their conversation. */
export async function runAssistantTurn(input: { userId: string; threadId?: string; message: string; page?: string; actor: AssistantActor }) {
  const message = input.message.trim();
  let thread = input.threadId ? await prisma.assistantThread.findFirst({ where: { id: input.threadId, userId: input.userId } }) : null;
  if (input.threadId && !thread) throw new Error('That conversation was not found.');
  if (!thread) {
    const title = message.replace(/\s+/g, ' ').slice(0, 60) || 'New conversation';
    thread = await prisma.assistantThread.create({ data: { userId: input.userId, title } });
  }
  const earlier = await prisma.assistantMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: 'desc' }, take: HISTORY });
  earlier.reverse();
  const userRow = await prisma.assistantMessage.create({ data: { threadId: thread.id, role: 'user', content: message } });

  let text: string;
  let actions: AssistantAction[] = [];
  let context: string | undefined;
  if (!assistantCanChat()) {
    const lastAssistant = [...earlier].reverse().find((row) => row.role === 'assistant');
    const reply = await mockReply(message, lastAssistant?.context ?? undefined, input.actor);
    text = reply.text;
    actions = reply.actions;
    context = reply.context;
  } else {
    try {
      const system = await buildAssistantSystem(input.actor, input.page);
      const turns = transcriptTurns([...earlier, userRow]);
      const result = await runAssistantLoop({
        system,
        turns,
        tools: ASSISTANT_TOOLS,
        chat: chatWithTools,
        execute: (call) => executeAssistantTool(call, input.actor),
      });
      text = result.text;
      actions = result.actions;
    } catch (err) {
      // A provider failure is saved as a reply so the conversation still reads in order.
      text = `I could not reach ${assistantModelLabel()}. ${(err as Error).message.slice(0, 300)}`;
    }
  }

  const assistantRow = await prisma.assistantMessage.create({
    data: { threadId: thread.id, role: 'assistant', content: text, actions: actions as unknown as Prisma.InputJsonValue, context },
  });
  const updated = await prisma.assistantThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  return { thread: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt }, messages: [view(userRow), view(assistantRow)] };
}
