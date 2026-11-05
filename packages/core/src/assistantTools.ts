import { prisma, type Prisma } from '@mh/db';
import { isEditable, PLATFORMS, PLATFORM_PRESETS, POST_STATUS_LABELS, type Platform, type PostStatus, type Role } from '@mh/shared';
import type { ChatTool, ToolCall } from './ai/chat';
import { recordEvent } from './activity';
import type { ToolOutcome } from './assistantLoop';
import { bus } from './bus';
import { config } from './config';
import { adaptCopyForPlatforms, chunksAllowedForProvider, generateContent, rewriteCopy } from './generation';
import { retrieve } from './knowledge';
import { notify } from './notify';
import { getDefaultOrgId } from './org';
import { applyPostAction } from './posts';
import { matchPerson } from './promptIntent';
import { createBoardTask } from './tasks';

export interface AssistantActor {
  id: string;
  name: string;
  role: Role;
}

/**
 * Everything the assistant is allowed to do. Approving, publishing, scheduling, archiving, and
 * deleting are deliberately absent: those stay on their buttons so a sentence cannot send or remove work.
 */
export const ASSISTANT_TOOLS: ChatTool[] = [
  {
    name: 'list_team',
    description: 'List the active people on the marketing team with their roles. Use before assigning work so you never invent a teammate.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_tasks',
    description: 'Search tasks on the board. Returns id, title, stage, assignee, and due date.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words in the title or description.' },
        assignee: { type: 'string', description: 'A teammate name, or "me".' },
        includeDone: { type: 'boolean', description: 'Include tasks in Done. Defaults to false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: 'Create a task on the board. Only call once you know what the task is, who it is for (or that it should be unassigned), and when it is due (or that it has no date).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative title.' },
        description: { type: 'string', description: 'Details, links, or acceptance notes.' },
        assignee: { type: 'string', description: 'Teammate name from list_team. Omit to leave unassigned.' },
        due: { type: 'string', description: 'Due date as YYYY-MM-DD or an ISO date-time. Omit for no date.' },
        stage: { type: 'string', description: 'Board column, such as Backlog or To Do. Defaults to To Do.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description: 'Change a task: title, description, assignee, due date, or board column. Cannot archive or delete.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string', description: 'Teammate name, or "nobody" to unassign.' },
        due: { type: 'string', description: 'YYYY-MM-DD, an ISO date-time, or "none" to clear it.' },
        stage: { type: 'string', description: 'Board column name.' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_posts',
    description: 'Search social posts. Returns id, title, status, networks, target time, and the start of the copy.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words in the title or copy.' },
        status: { type: 'string', enum: ['DRAFT', 'CREATOR_APPROVED', 'IN_REVIEW', 'SCHEDULED', 'POSTED', 'FAILED'] },
        mine: { type: 'boolean', description: 'Only posts this person created.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_post',
    description: 'Read one post in full: copy, per-network copy, status, reviewer notes, and whether this person may edit it.',
    parameters: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'], additionalProperties: false },
  },
  {
    name: 'create_post_draft',
    description: 'Write and save a new social post draft in the brand voice. It stays a draft until a person approves it.',
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'What the post is about, with any details the person gave.' },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] }, minItems: 1 },
        title: { type: 'string', description: 'Short internal label.' },
        targetDate: { type: 'string', description: 'Optional target publish time, ISO. A manager sets the real time on approval.' },
      },
      required: ['brief', 'platforms'],
      additionalProperties: false,
    },
  },
  {
    name: 'rewrite_post',
    description: 'Rewrite a post\'s copy from the person\'s notes and save it on the post. Per-network copy is refreshed to match.',
    parameters: {
      type: 'object',
      properties: {
        postId: { type: 'string' },
        notes: { type: 'string', description: 'What to change, in the person\'s words.' },
      },
      required: ['postId', 'notes'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the company knowledge base (products, accomplishments, documents, approved claims) for facts to use in an answer or a post.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'list_products',
    description: 'List the company\'s products with part numbers and a short description.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** A date-only answer means end of the working day, not midnight, so "due Friday" is still Friday. */
export function parseDue(value: string | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T17:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function team() {
  return prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
}

/** Resolves a spoken name to one teammate, or tells the model exactly what to ask. */
async function resolveAssignee(name: string | undefined, actor: AssistantActor): Promise<{ ok: true; id: string | null; name: string | null } | { ok: false; error: string }> {
  if (!name) return { ok: true, id: null, name: null };
  if (/^(me|myself)$/i.test(name)) return { ok: true, id: actor.id, name: actor.name };
  if (/^(nobody|no one|none|unassigned)$/i.test(name)) return { ok: true, id: null, name: null };
  const people = await team();
  const found = matchPerson(name, people);
  if (found.kind === 'one') return { ok: true, id: found.person.id, name: found.person.name };
  if (found.kind === 'many') return { ok: false, error: `More than one teammate matches "${name}": ${found.names.join(', ')}. Ask which one.` };
  return { ok: false, error: `Nobody named "${name}" is on the team. Team: ${people.map((p) => p.name).join(', ')}. Ask who it should go to.` };
}

function postLabel(post: { title: string }) {
  return post.title.length > 60 ? `${post.title.slice(0, 57)}...` : post.title;
}

export async function executeAssistantTool(call: ToolCall, actor: AssistantActor): Promise<ToolOutcome> {
  const args = call.args;
  switch (call.name) {
    case 'list_team': {
      const people = await team();
      return { result: people.map((p) => ({ name: p.name, role: p.role, isYou: p.id === actor.id })) };
    }

    case 'find_tasks': {
      const query = str(args.query);
      const assignee = str(args.assignee);
      // undefined = any assignee, null = only unassigned tasks, otherwise one person's tasks.
      let assigneeId: string | null | undefined;
      if (assignee) {
        const resolved = await resolveAssignee(assignee, actor);
        if (!resolved.ok) return { result: { ok: false, error: resolved.error } };
        assigneeId = resolved.id;
      }
      const tasks = await prisma.task.findMany({
        where: {
          active: true,
          assigneeId,
          ...(args.includeDone ? {} : { stage: { name: { not: 'Done' } } }),
          ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }] } : {}),
        },
        include: { stage: { select: { name: true } }, assignee: { select: { name: true } } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 20,
      });
      return {
        result: tasks.map((t) => ({ id: t.id, title: t.title, stage: t.stage.name, assignee: t.assignee?.name ?? null, due: t.dueDate?.toISOString() ?? null })),
      };
    }

    case 'create_task': {
      const title = str(args.title);
      if (!title) return { result: { ok: false, error: 'A task needs a title. Ask what it should say.' } };
      const assignee = await resolveAssignee(str(args.assignee), actor);
      if (!assignee.ok) return { result: { ok: false, error: assignee.error } };
      const dueText = str(args.due);
      const due = parseDue(dueText);
      if (dueText && !due) return { result: { ok: false, error: `"${dueText}" is not a date. Ask for the due date again.` } };
      const task = await createBoardTask({
        title,
        description: str(args.description),
        assigneeId: assignee.id,
        dueDate: due,
        stageName: str(args.stage),
        actorId: actor.id,
        actorName: actor.name,
        via: 'through the assistant',
      });
      return {
        result: { ok: true, id: task.id, title: task.title, stage: task.stage.name, assignee: task.assignee?.name ?? null, due: task.dueDate?.toISOString() ?? null },
        action: { kind: 'task', label: `Task: ${task.title}`, link: `/tasks/${task.id}` },
      };
    }

    case 'update_task': {
      const taskId = str(args.taskId);
      const before = taskId ? await prisma.task.findUnique({ where: { id: taskId }, include: { stage: true } }) : null;
      if (!before) return { result: { ok: false, error: 'That task was not found. Use find_tasks to get its id.' } };
      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (str(args.title)) data.title = str(args.title);
      if (typeof args.description === 'string') data.description = args.description;
      const assigneeText = str(args.assignee);
      let newAssignee: { id: string | null; name: string | null } | undefined;
      if (assigneeText) {
        const resolved = await resolveAssignee(assigneeText, actor);
        if (!resolved.ok) return { result: { ok: false, error: resolved.error } };
        newAssignee = resolved;
        data.assigneeId = resolved.id;
      }
      const dueText = str(args.due);
      if (dueText) {
        if (/^(none|no date|clear)$/i.test(dueText)) data.dueDate = null;
        else {
          const due = parseDue(dueText);
          if (!due) return { result: { ok: false, error: `"${dueText}" is not a date.` } };
          data.dueDate = due;
        }
      }
      const stageText = str(args.stage);
      if (stageText) {
        const stage = await prisma.stage.findFirst({ where: { boardId: before.boardId, name: { equals: stageText, mode: 'insensitive' } } });
        if (!stage) {
          const stages = await prisma.stage.findMany({ where: { boardId: before.boardId }, orderBy: { order: 'asc' } });
          return { result: { ok: false, error: `No column named "${stageText}". Columns: ${stages.map((s) => s.name).join(', ')}.` } };
        }
        data.stageId = stage.id;
      }
      const task = await prisma.task.update({ where: { id: before.id }, data, include: { stage: true, assignee: { select: { name: true } } } });
      await recordEvent({ actorId: actor.id, verb: 'update', entityType: 'task', entityId: task.id, link: `/tasks/${task.id}`, summary: `Task "${task.title}" updated by ${actor.name} through the assistant` });
      if (newAssignee?.id && newAssignee.id !== before.assigneeId) {
        await notify([newAssignee.id], { title: 'Task assigned to you', body: `${actor.name} assigned you "${task.title}".`, link: `/tasks/${task.id}` }, actor.id);
      }
      bus.publish({ userId: '*', type: 'task', payload: { id: task.id } });
      return {
        result: { ok: true, id: task.id, title: task.title, stage: task.stage.name, assignee: task.assignee?.name ?? null, due: task.dueDate?.toISOString() ?? null },
        action: { kind: 'task', label: `Task: ${task.title}`, link: `/tasks/${task.id}` },
      };
    }

    case 'find_posts': {
      const query = str(args.query);
      const status = str(args.status) as PostStatus | undefined;
      const posts = await prisma.post.findMany({
        where: {
          status,
          creatorId: args.mine ? actor.id : undefined,
          ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { body: { contains: query, mode: 'insensitive' } }] } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 15,
      });
      return {
        result: posts.map((p) => ({
          id: p.id,
          title: p.title,
          status: POST_STATUS_LABELS[p.status as PostStatus],
          networks: p.platforms,
          target: p.scheduledAt?.toISOString() ?? null,
          excerpt: p.body.slice(0, 160),
        })),
      };
    }

    case 'get_post': {
      const postId = str(args.postId);
      const post = postId ? await prisma.post.findUnique({ where: { id: postId }, include: { variants: true, creator: { select: { name: true } } } }) : null;
      if (!post) return { result: { ok: false, error: 'That post was not found. Use find_posts to get its id.' } };
      return {
        result: {
          id: post.id,
          title: post.title,
          status: POST_STATUS_LABELS[post.status as PostStatus],
          creator: post.creator.name,
          reviewNote: post.reviewNote,
          youCanEdit: isEditable(post.status as PostStatus, { role: actor.role, isCreator: post.creatorId === actor.id }),
          copy: post.body,
          perNetwork: post.variants.map((v) => ({ network: v.platform, copy: v.body })),
        },
        action: { kind: 'post', label: `Post: ${postLabel(post)}`, link: `/posts/${post.id}` },
      };
    }

    case 'create_post_draft': {
      const brief = str(args.brief);
      const platforms = (Array.isArray(args.platforms) ? args.platforms : []).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(String(p)));
      if (!brief) return { result: { ok: false, error: 'Ask what the post should be about.' } };
      if (!platforms.length) return { result: { ok: false, error: 'Ask which networks the post is for.' } };
      const orgId = await getDefaultOrgId();
      const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true } });
      const lower = brief.toLowerCase();
      const productIds = products.filter((p) => p.name.length > 2 && lower.includes(p.name.toLowerCase())).map((p) => p.id);
      const generated = await generateContent({ orgId, type: 'SOCIAL_POST', brief, platform: platforms[0], productIds });
      const adapted = platforms.length > 1
        ? await adaptCopyForPlatforms(orgId, generated.text, platforms)
        : { variants: { [platforms[0]!]: generated.text.slice(0, PLATFORM_PRESETS[platforms[0]!].maxChars) }, warnings: { [platforms[0]!]: generated.warnings } as Record<string, unknown[]> };
      const title = (str(args.title) ?? brief).slice(0, 140);
      const target = parseDue(str(args.targetDate));
      const post = await prisma.post.create({
        data: {
          title,
          body: generated.text,
          platforms,
          scheduledAt: target,
          creatorId: actor.id,
          aiWarnings: generated.warnings as unknown as Prisma.InputJsonValue,
          variants: {
            create: platforms.map((p) => ({ platform: p, body: adapted.variants[p] ?? generated.text, aiWarnings: (adapted.warnings[p] ?? []) as unknown as Prisma.InputJsonValue })),
          },
        },
      });
      await recordEvent({ actorId: actor.id, verb: 'create', entityType: 'post', entityId: post.id, link: `/posts/${post.id}`, summary: `Draft "${post.title}" created by ${actor.name} through the assistant` });
      bus.publish({ userId: '*', type: 'post', payload: { id: post.id, status: post.status } });
      return {
        result: { ok: true, id: post.id, title: post.title, status: 'Draft', copy: post.body, warnings: generated.warnings.map((w) => w.message) },
        action: { kind: 'post', label: `Draft: ${postLabel(post)}`, link: `/posts/${post.id}` },
      };
    }

    case 'rewrite_post': {
      const postId = str(args.postId);
      const notes = str(args.notes);
      const post = postId ? await prisma.post.findUnique({ where: { id: postId }, include: { variants: true } }) : null;
      if (!post) return { result: { ok: false, error: 'That post was not found. Use find_posts to get its id.' } };
      if (!notes) return { result: { ok: false, error: 'Ask what should change.' } };
      const status = post.status as PostStatus;
      if (!isEditable(status, { role: actor.role, isCreator: post.creatorId === actor.id })) {
        const why = status === 'IN_REVIEW' ? 'It is in manager review, so only a manager can edit it.' : `It is ${POST_STATUS_LABELS[status].toLowerCase()} and can no longer be edited here.`;
        return { result: { ok: false, error: `You cannot edit this post. ${why}` } };
      }
      const orgId = await getDefaultOrgId();
      const platforms = post.platforms as Platform[];
      const rewritten = await rewriteCopy({ orgId, body: post.body, notes, platform: platforms.length === 1 ? platforms[0] : undefined });
      const variants = platforms.length > 1
        ? (await adaptCopyForPlatforms(orgId, rewritten.text, platforms)).variants
        : Object.fromEntries(platforms.map((p) => [p, rewritten.text.slice(0, PLATFORM_PRESETS[p].maxChars)]));
      await prisma.$transaction([
        prisma.post.update({ where: { id: post.id }, data: { body: rewritten.text, aiWarnings: rewritten.warnings as unknown as Prisma.InputJsonValue } }),
        ...post.variants.map((v) => prisma.postVariant.update({ where: { id: v.id }, data: { body: variants[v.platform] ?? rewritten.text } })),
      ]);
      // The old copy goes in the work log so a rewrite the person dislikes can be put back by hand.
      if (status === 'IN_REVIEW') await applyPostAction(post.id, 'managerEdit', actor);
      await recordEvent({
        actorId: actor.id,
        verb: 'update',
        entityType: 'post',
        entityId: post.id,
        link: `/posts/${post.id}`,
        summary: `Post "${post.title}" rewritten by ${actor.name} through the assistant: "${notes.slice(0, 120)}"`,
        meta: { previousBody: post.body, notes },
      });
      bus.publish({ userId: '*', type: 'post', payload: { id: post.id, status: post.status } });
      return {
        result: { ok: true, id: post.id, newCopy: rewritten.text, warnings: rewritten.warnings.map((w) => w.message) },
        action: { kind: 'post', label: `Rewritten: ${postLabel(post)}`, link: `/posts/${post.id}` },
      };
    }

    case 'search_knowledge': {
      const query = str(args.query);
      if (!query) return { result: [] };
      const orgId = await getDefaultOrgId();
      const chunks = await retrieve(orgId, query, 8).catch(() => []);
      // Cloud models never see internal knowledge, same rule as drafting.
      const { kept, droppedInternal } = chunksAllowedForProvider(chunks, config.AI_TEXT_PROVIDER);
      return { result: { results: kept.slice(0, 6).map((c) => ({ kind: c.sourceType, text: c.text.slice(0, 700) })), internalOmitted: droppedInternal } };
    }

    case 'list_products': {
      const products = await prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' }, take: 50 });
      return { result: products.map((p) => ({ name: p.name, sku: p.sku, partNumbers: p.partNumbers, description: p.description.slice(0, 240), url: p.url })) };
    }

    default:
      return { result: { ok: false, error: `There is no tool named ${call.name}.` } };
  }
}
