import { prisma } from '@mh/db';
import { isSocialChannel, marketChannel } from '@mh/shared';
import { enqueue } from './queue';

export class MarketLinkError extends Error {}

/**
 * Saves a competitor or partner link and queues a read.
 * Social hosts rarely allow a fetch, so those store the link itself instead of the page.
 */
export async function attachMarketLink(input: {
  organizationId: string;
  productId?: string | null;
  name: string;
  role: 'COMPETITOR' | 'PARTNER';
  url: string;
}) {
  const productId = input.productId || null;
  const duplicate = await prisma.marketLink.findFirst({
    where: { organizationId: input.organizationId, productId, url: input.url, role: input.role },
  });
  if (duplicate) throw new MarketLinkError('That link is already saved');

  const channel = marketChannel(input.url);
  const roleLabel = input.role === 'COMPETITOR' ? 'Competitor' : 'Partner';
  const product = productId ? await prisma.product.findUnique({ where: { id: productId } }) : null;
  const title = product ? `${roleLabel} of ${product.name}: ${input.name}` : `${roleLabel}: ${input.name}`;
  const social = isSocialChannel(channel);
  const source = await prisma.source.create({
    data: {
      organizationId: input.organizationId,
      productId,
      url: input.url,
      kind: channel === 'linkedin' ? 'LINKEDIN' : social ? 'MANUAL' : 'WEBSITE',
      title,
      origin: 'market',
      content: social ? `${title} (${channel}): ${input.url}` : '',
      status: social ? 'OK' : 'PENDING',
      recrawlDays: social ? null : 30,
    },
  });
  const link = await prisma.marketLink.create({
    data: {
      organizationId: input.organizationId,
      productId,
      name: input.name,
      role: input.role,
      url: input.url,
      channel,
      sourceId: source.id,
    },
  });
  if (social) await enqueue('embed-knowledge', { orgId: input.organizationId, sourceType: 'SOURCE', sourceId: source.id }).catch(() => undefined);
  else await enqueue('scrape-source', { orgId: input.organizationId, sourceId: source.id }).catch(() => undefined);
  if (productId) await enqueue('embed-knowledge', { orgId: input.organizationId, sourceType: 'PRODUCT', sourceId: productId }).catch(() => undefined);
  return link;
}

export async function removeMarketLink(id: string) {
  const link = await prisma.marketLink.findUnique({ where: { id } });
  if (!link) return null;
  if (link.sourceId) {
    await prisma.knowledgeChunk.deleteMany({ where: { sourceId: link.sourceId } });
    await prisma.source.delete({ where: { id: link.sourceId } }).catch(() => undefined);
  }
  await prisma.marketLink.delete({ where: { id } });
  if (link.productId) await enqueue('embed-knowledge', { orgId: link.organizationId, sourceType: 'PRODUCT', sourceId: link.productId }).catch(() => undefined);
  return link;
}

/** Drops uploaded documents and competitor/partner pages before the product row is deleted. */
export async function removeProductKnowledge(productId: string): Promise<void> {
  const links = await prisma.marketLink.findMany({ where: { productId } });
  for (const link of links) {
    if (!link.sourceId) continue;
    await prisma.knowledgeChunk.deleteMany({ where: { sourceId: link.sourceId } });
    await prisma.source.delete({ where: { id: link.sourceId } }).catch(() => undefined);
  }
  await prisma.marketLink.deleteMany({ where: { productId } });
  const docs = await prisma.source.findMany({ where: { productId, kind: 'DOCUMENT' } });
  for (const doc of docs) {
    await prisma.knowledgeChunk.deleteMany({ where: { sourceId: doc.id } });
    await prisma.source.delete({ where: { id: doc.id } });
  }
}
