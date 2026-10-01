import { hasRole, type Role } from './roles';

export const POST_STATUSES = [
  'DRAFT',
  'CREATOR_APPROVED',
  'IN_REVIEW',
  'SCHEDULED',
  'POSTED',
  'FAILED',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: 'Draft',
  CREATOR_APPROVED: 'Creator Approved',
  IN_REVIEW: 'In Manager Review',
  SCHEDULED: 'Scheduled',
  POSTED: 'Posted',
  FAILED: 'Failed',
};

export const POST_ACTIONS = [
  'creatorApprove',
  'startReview',
  'managerEdit',
  'returnToCreator',
  'approve',
  'unschedule',
  'publishSucceeded',
  'publishFailed',
  'retry',
] as const;
export type PostAction = (typeof POST_ACTIONS)[number];

type Actor = 'creator' | 'manager' | 'system';

interface Transition {
  from: PostStatus[];
  to: PostStatus;
  actor: Actor;
}

const TRANSITIONS: Record<PostAction, Transition> = {
  creatorApprove: { from: ['DRAFT'], to: 'CREATOR_APPROVED', actor: 'creator' },
  startReview: { from: ['CREATOR_APPROVED'], to: 'IN_REVIEW', actor: 'manager' },
  managerEdit: { from: ['IN_REVIEW'], to: 'IN_REVIEW', actor: 'manager' },
  returnToCreator: { from: ['CREATOR_APPROVED', 'IN_REVIEW'], to: 'DRAFT', actor: 'manager' },
  approve: { from: ['IN_REVIEW'], to: 'SCHEDULED', actor: 'manager' },
  unschedule: { from: ['SCHEDULED', 'FAILED'], to: 'IN_REVIEW', actor: 'manager' },
  publishSucceeded: { from: ['SCHEDULED'], to: 'POSTED', actor: 'system' },
  publishFailed: { from: ['SCHEDULED'], to: 'FAILED', actor: 'system' },
  retry: { from: ['FAILED'], to: 'SCHEDULED', actor: 'manager' },
};

export interface TransitionContext {
  role: Role | 'SYSTEM';
  /** Whether the acting user created the post. */
  isCreator: boolean;
}

export type TransitionResult = { ok: true; to: PostStatus } | { ok: false; reason: string };

export function transitionPost(
  from: PostStatus,
  action: PostAction,
  ctx: TransitionContext,
): TransitionResult {
  const t = TRANSITIONS[action];
  if (!t.from.includes(from)) {
    return { ok: false, reason: `Cannot ${action} a post that is ${POST_STATUS_LABELS[from]}` };
  }
  if (t.actor === 'system') {
    if (ctx.role !== 'SYSTEM') return { ok: false, reason: 'Only the publisher can do this' };
  } else if (ctx.role === 'SYSTEM') {
    return { ok: false, reason: 'System cannot perform user actions' };
  } else if (t.actor === 'manager' && !hasRole(ctx.role, 'MANAGER')) {
    return { ok: false, reason: 'Only managers can do this' };
  } else if (t.actor === 'creator' && !ctx.isCreator && !hasRole(ctx.role, 'MANAGER')) {
    return { ok: false, reason: 'Only the creator can approve their draft' };
  }
  return { ok: true, to: t.to };
}

/** Actions available to a user for a post in a given status, for rendering buttons. */
export function availableActions(status: PostStatus, ctx: TransitionContext): PostAction[] {
  return POST_ACTIONS.filter((a) => transitionPost(status, a, ctx).ok);
}

/** Posts can only be freely edited in these states. */
export function isEditable(status: PostStatus, ctx: TransitionContext): boolean {
  if (status === 'DRAFT') return ctx.isCreator || (ctx.role !== 'SYSTEM' && hasRole(ctx.role, 'MANAGER'));
  if (status === 'IN_REVIEW') return ctx.role !== 'SYSTEM' && hasRole(ctx.role, 'MANAGER');
  return false;
}
