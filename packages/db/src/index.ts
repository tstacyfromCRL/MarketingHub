import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __mhPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__mhPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__mhPrisma = prisma;

/** Formats an embedding for use in raw SQL as a pgvector literal: `$1::vector`. */
export function toVector(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')}]`;
}

export const DEFAULT_STAGES = [
  { name: 'Backlog', color: '#64748b' },
  { name: 'To Do', color: '#3b82f6' },
  { name: 'In Progress', color: '#f59e0b' },
  { name: 'Review', color: '#8b5cf6' },
  { name: 'Done', color: '#22c55e' },
];

export const DEFAULT_CATEGORIES = [
  { name: 'Social', color: '#ec4899' },
  { name: 'Email', color: '#0ea5e9' },
  { name: 'Blog', color: '#10b981' },
  { name: 'Design', color: '#f97316' },
  { name: 'Video', color: '#ef4444' },
];

/** Idempotently creates the default board, stages, categories and brand profile. */
export async function ensureDefaults(db: PrismaClient = prisma): Promise<void> {
  const board = await db.board.findFirst();
  if (!board) {
    await db.board.create({
      data: {
        name: 'Marketing',
        stages: { create: DEFAULT_STAGES.map((s, i) => ({ ...s, order: i })) },
      },
    });
  }
  if ((await db.taskCategory.count()) === 0) {
    await db.taskCategory.createMany({ data: DEFAULT_CATEGORIES });
  }
  let org = await db.organization.findUnique({ where: { slug: 'default' } });
  if (!org) {
    const named = await db.brandProfile.findFirst({ where: { companyName: { not: '' } } });
    org = await db.organization.create({ data: { name: named?.companyName || 'Default', slug: 'default' } });
  }
  const brand = await db.brandProfile.findUnique({ where: { organizationId: org.id } });
  if (!brand) await db.brandProfile.create({ data: { organizationId: org.id, dos: [], donts: [] } });
}
