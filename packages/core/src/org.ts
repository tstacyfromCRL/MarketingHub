import { prisma } from '@mh/db';

let cachedDefaultOrgId: string | null = null;

/** The single company this server is running for. Tests that need a second org create one themselves. */
export async function getDefaultOrgId(): Promise<string> {
  if (cachedDefaultOrgId) return cachedDefaultOrgId;
  const existing = await prisma.organization.findUnique({ where: { slug: 'default' } });
  if (existing) {
    cachedDefaultOrgId = existing.id;
    return existing.id;
  }
  const named = await prisma.brandProfile.findFirst({ where: { companyName: { not: '' } }, select: { companyName: true } });
  const org = await prisma.organization.create({ data: { name: named?.companyName || 'Default', slug: 'default' } });
  cachedDefaultOrgId = org.id;
  return org.id;
}

/** Test helper. The cache would otherwise keep pointing at an org a test deleted. */
export function clearDefaultOrgCache(): void {
  cachedDefaultOrgId = null;
}
