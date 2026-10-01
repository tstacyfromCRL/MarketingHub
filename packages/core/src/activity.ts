import { prisma, type Prisma } from '@mh/db';
import { bus } from './bus';

export interface ActivityInput {
  actorId: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  /** Human-readable sentence, e.g. `Post "Fall launch" approved by Dana for 10/05/2026 2:00 PM`. */
  summary: string;
  link?: string;
  meta?: Prisma.InputJsonValue;
}

/** Writes a work log entry. Every significant mutation in the app goes through here. */
export async function recordEvent(input: ActivityInput) {
  const event = await prisma.activityEvent.create({
    data: {
      actorId: input.actorId,
      verb: input.verb,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      link: input.link,
      meta: input.meta ?? {},
    },
    include: { actor: { select: { id: true, name: true } } },
  });
  bus.publish({ userId: '*', type: 'activity', payload: event });
  return event;
}

/** "10/05/2026 2:00 PM" in the server's locale; used inside work log sentences. */
export function formatWhen(d: Date, timeZone?: string): string {
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).replace(',', '');
}
