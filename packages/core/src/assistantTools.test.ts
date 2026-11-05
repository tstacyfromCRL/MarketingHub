import { beforeEach, describe, expect, it, vi } from 'vitest';

// Everything the tools touch is mocked so these tests check the rules, not the database.
const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  task: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  stage: { findFirst: vi.fn(), findMany: vi.fn() },
  post: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  postVariant: { update: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock('@mh/db', () => ({ prisma: db }));
vi.mock('./activity', () => ({ recordEvent: vi.fn(async () => ({})) }));
vi.mock('./bus', () => ({ bus: { publish: vi.fn() } }));
vi.mock('./notify', () => ({ notify: vi.fn(async () => undefined) }));
vi.mock('./org', () => ({ getDefaultOrgId: vi.fn(async () => 'org_default') }));
vi.mock('./knowledge', () => ({ retrieve: vi.fn(async () => []) }));
vi.mock('./posts', () => ({ applyPostAction: vi.fn(async () => ({})) }));
vi.mock('./tasks', () => ({ createBoardTask: vi.fn() }));
vi.mock('./generation', () => ({
  adaptCopyForPlatforms: vi.fn(async () => ({ variants: {}, warnings: {} })),
  chunksAllowedForProvider: vi.fn((chunks: unknown[]) => ({ kept: chunks, droppedInternal: false })),
  generateContent: vi.fn(async () => ({ text: 'Draft copy', warnings: [] })),
  rewriteCopy: vi.fn(async () => ({ text: 'Rewritten copy', warnings: [] })),
}));

import { applyPostAction } from './posts';
import { createBoardTask } from './tasks';
import { adaptCopyForPlatforms, rewriteCopy } from './generation';
import { ASSISTANT_TOOLS, executeAssistantTool, parseDue, type AssistantActor } from './assistantTools';
import type { ToolCall } from './ai/chat';

const creator: AssistantActor = { id: 'u-tony', name: 'Tony Stacy', role: 'CREATOR' };
const manager: AssistantActor = { id: 'u-dana', name: 'Dana Reyes', role: 'MANAGER' };
const team = [
  { id: 'u-tony', name: 'Tony Stacy', role: 'CREATOR' },
  { id: 'u-nguyen', name: 'Tony Nguyen', role: 'CREATOR' },
  { id: 'u-dana', name: 'Dana Reyes', role: 'MANAGER' },
];

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `c-${name}`, name, args });

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', title: 'Film the booth', description: null, boardId: 'board-1', assigneeId: null, dueDate: null,
    stage: { name: 'To Do' }, assignee: null, ...overrides,
  };
}

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1', title: 'Fall launch', body: 'Old copy', platforms: ['linkedin'], status: 'DRAFT', creatorId: 'u-tony',
    variants: [{ id: 'v-1', platform: 'linkedin', body: 'Old copy' }], ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue(team);
  db.stage.findFirst.mockResolvedValue({ id: 'stage-todo', name: 'To Do' });
  db.stage.findMany.mockResolvedValue([{ name: 'To Do' }, { name: 'Done' }]);
  vi.mocked(createBoardTask).mockImplementation(async (input) => ({
    id: 'task-new', title: input.title, stage: { name: 'To Do' }, assignee: input.assigneeId ? { name: 'Tony Stacy' } : null, dueDate: input.dueDate ?? null,
  }) as never);
});

describe('tool list', () => {
  it('never offers approve, publish, schedule, archive, or delete', () => {
    const names = ASSISTANT_TOOLS.map((tool) => tool.name);
    for (const banned of ['approve_post', 'publish_post', 'schedule_post', 'archive_task', 'delete_task', 'delete_post']) {
      expect(names).not.toContain(banned);
    }
  });

  it('answers an unknown tool name with an error instead of acting', async () => {
    const outcome = await executeAssistantTool(call('approve_post', { postId: 'post-1' }), creator);
    expect(outcome.result).toEqual({ ok: false, error: 'There is no tool named approve_post.' });
  });
});

describe('create_task', () => {
  it('refuses a first name that matches two teammates and lists both', async () => {
    const outcome = await executeAssistantTool(call('create_task', { title: 'Film the booth', assignee: 'Tony' }), manager);
    expect(outcome.result).toMatchObject({ ok: false });
    expect((outcome.result as { error: string }).error).toMatch(/More than one teammate.*Tony Stacy.*Tony Nguyen/);
    expect(createBoardTask).not.toHaveBeenCalled();
  });

  it('asks who it should go to when the name is not on the team', async () => {
    const outcome = await executeAssistantTool(call('create_task', { title: 'Film the booth', assignee: 'Pat' }), creator);
    expect((outcome.result as { error: string }).error).toMatch(/Nobody named "Pat" is on the team/);
    expect(createBoardTask).not.toHaveBeenCalled();
  });

  it('assigns to the person asking when they say "me" without a lookup', async () => {
    await executeAssistantTool(call('create_task', { title: 'Film the booth', assignee: 'me' }), creator);
    expect(createBoardTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'u-tony', actorId: 'u-tony' }));
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('leaves the task unassigned when the person says nobody', async () => {
    await executeAssistantTool(call('create_task', { title: 'Film the booth', assignee: 'nobody' }), creator);
    expect(createBoardTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null }));
  });

  it('treats a date-only due date as the end of that working day', async () => {
    await executeAssistantTool(call('create_task', { title: 'Film the booth', due: '2026-11-06' }), creator);
    const due = vi.mocked(createBoardTask).mock.calls[0]![0].dueDate as Date;
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(10);
    expect(due.getDate()).toBe(6);
    expect(due.getHours()).toBe(17);
  });

  it('asks again when the due date cannot be read', async () => {
    const outcome = await executeAssistantTool(call('create_task', { title: 'Film the booth', due: 'someday soon' }), creator);
    expect((outcome.result as { error: string }).error).toMatch(/is not a date/);
    expect(createBoardTask).not.toHaveBeenCalled();
  });

  it('needs a title before it creates anything', async () => {
    const outcome = await executeAssistantTool(call('create_task', { assignee: 'me' }), creator);
    expect(outcome.result).toMatchObject({ ok: false });
    expect(createBoardTask).not.toHaveBeenCalled();
  });
});

describe('find_tasks', () => {
  it('with "nobody" returns only unassigned tasks', async () => {
    db.task.findMany.mockResolvedValue([]);
    await executeAssistantTool(call('find_tasks', { assignee: 'nobody' }), creator);
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assigneeId: null }) }));
  });
});

describe('rewrite_post', () => {
  it('refuses a creator rewriting a post that is in manager review', async () => {
    db.post.findUnique.mockResolvedValue(postRow({ status: 'IN_REVIEW' }));
    const outcome = await executeAssistantTool(call('rewrite_post', { postId: 'post-1', notes: 'Shorter' }), creator);
    expect((outcome.result as { error: string }).error).toMatch(/only a manager can edit it/);
    expect(rewriteCopy).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('lets a manager rewrite a post in review and logs the manager edit', async () => {
    db.post.findUnique.mockResolvedValue(postRow({ status: 'IN_REVIEW' }));
    const outcome = await executeAssistantTool(call('rewrite_post', { postId: 'post-1', notes: 'Shorter' }), manager);
    expect(outcome.result).toMatchObject({ ok: true, newCopy: 'Rewritten copy' });
    expect(rewriteCopy).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Shorter', body: 'Old copy' }));
    expect(applyPostAction).toHaveBeenCalledWith('post-1', 'managerEdit', manager);
  });

  it('lets the creator rewrite their own draft without a manager step', async () => {
    db.post.findUnique.mockResolvedValue(postRow({ status: 'DRAFT' }));
    const outcome = await executeAssistantTool(call('rewrite_post', { postId: 'post-1', notes: 'Friendlier' }), creator);
    expect(outcome.result).toMatchObject({ ok: true });
    expect(applyPostAction).not.toHaveBeenCalled();
  });

  it('refuses a post that is already scheduled', async () => {
    db.post.findUnique.mockResolvedValue(postRow({ status: 'SCHEDULED' }));
    const outcome = await executeAssistantTool(call('rewrite_post', { postId: 'post-1', notes: 'Shorter' }), creator);
    expect((outcome.result as { error: string }).error).toMatch(/can no longer be edited/);
    expect(rewriteCopy).not.toHaveBeenCalled();
  });

  it('asks what should change when no notes were given', async () => {
    db.post.findUnique.mockResolvedValue(postRow());
    const outcome = await executeAssistantTool(call('rewrite_post', { postId: 'post-1' }), creator);
    expect((outcome.result as { error: string }).error).toMatch(/Ask what should change/);
    expect(rewriteCopy).not.toHaveBeenCalled();
  });

  it('re-tailors each network when the post targets more than one', async () => {
    db.post.findUnique.mockResolvedValue(postRow({ platforms: ['linkedin', 'x'], variants: [] }));
    vi.mocked(adaptCopyForPlatforms).mockResolvedValueOnce({ variants: { linkedin: 'LI copy', x: 'X copy' }, warnings: {} });
    await executeAssistantTool(call('rewrite_post', { postId: 'post-1', notes: 'Shorter' }), creator);
    expect(adaptCopyForPlatforms).toHaveBeenCalledWith('org_default', 'Rewritten copy', ['linkedin', 'x']);
  });
});

describe('parseDue', () => {
  it('reads a date-only answer as 5 PM that day', () => {
    const due = parseDue('2026-11-06');
    expect(due?.getHours()).toBe(17);
    expect(due?.getDate()).toBe(6);
  });

  it('keeps an explicit date and time', () => {
    expect(parseDue('2026-11-06T09:30:00')?.getHours()).toBe(9);
  });

  it('returns null for text that is not a date', () => {
    expect(parseDue('someday')).toBeNull();
  });

  it('returns null when nothing was given', () => {
    expect(parseDue(undefined)).toBeNull();
  });
});
