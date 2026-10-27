import { prisma } from '@mh/db';
import {
  POST_STATUS_LABELS,
  PLATFORM_PRESETS,
  transitionPost,
  type Platform,
  type PostAction,
  type PostStatus,
  type Role,
} from '@mh/shared';
import { formatWhen, recordEvent } from './activity';
import { bus } from './bus';
import { config } from './config';
import { notify, notifyRole } from './notify';
import { enqueue } from './queue';

export type Actor = { id: string; name: string; role: Role } | 'SYSTEM';

export class WorkflowError extends Error {}

const platformList = (platforms: string[]) => platforms.map((p) => PLATFORM_PRESETS[p as Platform]?.label ?? p).join(', ');

/** Queues publishing at the scheduled time. The periodic sweep is a safety net for missed jobs. */
export async function schedulePublish(postId: string, scheduledAt: Date) {
  await enqueue('publish-post', { postId }, { delayMs: Math.max(0, scheduledAt.getTime() - Date.now()), jobId: `publish:${postId}:${scheduledAt.getTime()}` });
}

/**
 * Applies a workflow action to a post (see @mh/shared postWorkflow), then writes the work log
 * entry and sends notifications for it.
 */
export async function applyPostAction(postId: string, action: PostAction, actor: Actor, opts: { note?: string; scheduledAt?: Date; summaryExtra?: string } = {}) {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const isSystem = actor === 'SYSTEM';
  const result = transitionPost(post.status as PostStatus, action, {
    role: isSystem ? 'SYSTEM' : actor.role,
    isCreator: !isSystem && actor.id === post.creatorId,
  });
  if (!result.ok) throw new WorkflowError(result.reason);

  const who = isSystem ? 'Mantis' : actor.name;
  const link = `/posts/${post.id}`;
  const data: Record<string, unknown> = { status: result.to };
  let summary = '';
  let scheduledAt = post.scheduledAt;

  switch (action) {
    case 'creatorApprove':
      data.reviewNote = null;
      summary = `Post "${post.title}" approved by creator ${who} and sent for manager review`;
      break;
    case 'startReview':
      data.reviewerId = (actor as { id: string }).id;
      summary = `${who} started reviewing post "${post.title}"`;
      break;
    case 'managerEdit':
      data.reviewerId = (actor as { id: string }).id;
      summary = `Post "${post.title}" edited by manager ${who}`;
      break;
    case 'returnToCreator':
      data.reviewNote = opts.note ?? null;
      summary = `Post "${post.title}" returned to creator by ${who}${opts.note ? `: "${opts.note}"` : ''}`;
      break;
    case 'approve': {
      scheduledAt = opts.scheduledAt ?? post.scheduledAt;
      if (!scheduledAt) throw new WorkflowError('Choose a date and time to schedule this post');
      if (scheduledAt.getTime() < Date.now() - 60_000) throw new WorkflowError('The scheduled time is in the past');
      data.scheduledAt = scheduledAt;
      data.reviewerId = (actor as { id: string }).id;
      summary = `${who} approved post "${post.title}" for ${formatWhen(scheduledAt, config.TEAM_TIMEZONE)} on ${platformList(post.platforms)}`;
      break;
    }
    case 'unschedule':
      summary = `Post "${post.title}" unscheduled by ${who}`;
      break;
    case 'retry':
      await prisma.postVariant.updateMany({ where: { postId, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, error: null } });
      scheduledAt = post.scheduledAt && post.scheduledAt > new Date() ? post.scheduledAt : new Date();
      data.scheduledAt = scheduledAt;
      summary = `Publishing of post "${post.title}" retried by ${who}`;
      break;
    case 'publishSucceeded':
      data.postedAt = new Date();
      summary = `Post "${post.title}" posted to ${platformList(post.platforms)}${opts.summaryExtra ?? ''}`;
      break;
    case 'publishFailed':
      summary = `Post "${post.title}" failed to publish${opts.summaryExtra ?? ''}`;
      break;
  }

  const updated = await prisma.post.update({ where: { id: postId }, data });
  await recordEvent({ actorId: isSystem ? null : actor.id, verb: action, entityType: 'post', entityId: post.id, summary, link, meta: { from: post.status, to: result.to } });
  bus.publish({ userId: '*', type: 'post', payload: { id: post.id, status: result.to } });

  const except = isSystem ? undefined : actor.id;
  switch (action) {
    case 'creatorApprove':
      await notifyRole('MANAGER', { title: 'Post ready for review', body: `"${post.title}" from ${who} is waiting for review.`, link }, except);
      break;
    case 'managerEdit':
      await notify([post.creatorId], { title: 'Your post was edited', body: `${who} edited "${post.title}".`, link }, except);
      break;
    case 'returnToCreator':
      await notify([post.creatorId], { title: 'Post returned with notes', body: `${who}: ${opts.note ?? 'Please revise.'}`, link }, except);
      break;
    case 'approve':
      await notify([post.creatorId], { title: 'Post approved and scheduled', body: `"${post.title}" goes out ${formatWhen(scheduledAt!, config.TEAM_TIMEZONE)}.`, link }, except);
      await schedulePublish(post.id, scheduledAt!);
      break;
    case 'retry':
      await schedulePublish(post.id, scheduledAt!);
      break;
    case 'publishSucceeded':
      await notify([post.creatorId, post.reviewerId], { title: 'Post published', body: summary, link });
      break;
    case 'publishFailed':
      await notifyRole('MANAGER', { title: 'Post failed to publish', body: summary, link });
      await notify([post.creatorId], { title: 'Post failed to publish', body: summary, link });
      break;
  }
  return updated;
}

export function statusLabel(s: string) {
  return POST_STATUS_LABELS[s as PostStatus] ?? s;
}
