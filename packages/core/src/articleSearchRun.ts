/**
 * Run a saved keyword search and file a chosen article into the knowledge base.
 * Filing reads the page and embeds it. The search itself only stores titles and addresses.
 */
import { prisma } from '@mh/db';
import { dueSearchIds, fetchSearchHits, isPublicArticleUrl } from './articleSearch';
import { enqueue } from './queue';
import { scrapeSource } from './scrape';

export async function runArticleSearch(searchId: string): Promise<number> {
  const search = await prisma.articleSearch.findUnique({ where: { id: searchId } });
  if (!search) throw new Error('That search no longer exists.');
  try {
    const hits = await fetchSearchHits(search.keywords);
    for (const hit of hits) {
      await prisma.articleHit.upsert({
        where: { searchId_url: { searchId, url: hit.url } },
        create: { searchId, title: hit.title, url: hit.url, snippet: hit.snippet },
        update: { title: hit.title, snippet: hit.snippet },
      });
    }
    await prisma.articleSearch.update({ where: { id: searchId }, data: { lastRunAt: new Date(), lastError: null } });
    return hits.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The search failed.';
    await prisma.articleSearch.update({ where: { id: searchId }, data: { lastError: message } });
    throw err;
  }
}

/** Hourly check. Each due search is its own job so one slow page does not block the others. */
export async function sweepArticleSearches(orgId: string): Promise<void> {
  const rows = await prisma.articleSearch.findMany({
    where: { organizationId: orgId },
    select: { id: true, intervalDays: true, lastRunAt: true },
  });
  const hour = Math.floor(Date.now() / 3_600_000);
  for (const id of dueSearchIds(rows, new Date())) {
    await enqueue('run-article-search', { orgId, searchId: id }, { jobId: `article-search:${id}:${hour}` });
  }
}

export async function assignArticleHit(
  hitId: string,
  scope: { productId: string | null; projectId: string | null },
): Promise<{ sourceId: string; title: string; url: string }> {
  const hit = await prisma.articleHit.findUnique({ where: { id: hitId }, include: { search: true } });
  if (!hit) throw new Error('That article is no longer in the results.');
  if (!isPublicArticleUrl(hit.url)) throw new Error('That address cannot be saved.');
  const orgId = hit.search.organizationId;
  if (scope.productId) {
    const product = await prisma.product.findFirst({ where: { id: scope.productId, organizationId: orgId } });
    if (!product) throw new Error('Choose a product from this company.');
  }
  if (scope.projectId) {
    const project = await prisma.project.findFirst({ where: { id: scope.projectId, organizationId: orgId } });
    if (!project) throw new Error('Choose a project from this company.');
  }

  const externalKey = `search:${hit.url}`;
  const existing = hit.sourceId
    ? await prisma.source.findUnique({ where: { id: hit.sourceId } })
    : await prisma.source.findUnique({ where: { organizationId_externalKey: { organizationId: orgId, externalKey } } });
  const source = existing
    ? await prisma.source.update({
        where: { id: existing.id },
        data: { productId: scope.productId, projectId: scope.projectId, title: existing.title || hit.title },
      })
    : await prisma.source.create({
        data: {
          organizationId: orgId,
          url: hit.url,
          kind: 'ARTICLE',
          title: hit.title,
          productId: scope.productId,
          projectId: scope.projectId,
          origin: 'search',
          externalKey,
          status: 'PENDING',
        },
      });
  if (hit.sourceId !== source.id) {
    await prisma.articleHit.update({ where: { id: hit.id }, data: { sourceId: source.id } });
  }
  // Read the page the first time it is filed. Moving it between company, product, and project does not fetch it again.
  if (!existing || existing.status !== 'OK' || !existing.content) await scrapeSource(source.id);
  return { sourceId: source.id, title: hit.title, url: hit.url };
}
