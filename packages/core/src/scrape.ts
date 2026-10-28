import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { prisma } from '@mh/db';
import { embedKnowledge } from './knowledge';
import { recordEvent } from './activity';

const LINKEDIN = /(^|\.)linkedin\.com$/i;

export function isLinkedIn(url: string): boolean {
  try {
    return LINKEDIN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Fetches a page and extracts its readable article text. */
export async function extractReadable(url: string): Promise<{ title: string; text: string }> {
  if (isLinkedIn(url)) {
    throw new Error('LinkedIn does not allow scraping. Paste the post text into the source instead.');
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MantisBot/1.0 (+knowledge-base)', Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (!type.includes('html')) return { title: url, text: body.slice(0, 200_000) };

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(body, { url, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  const text = (article?.textContent ?? dom.window.document.body?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  if (text.length < 50) throw new Error('Could not find readable text on that page');
  return { title: article?.title || dom.window.document.title || url, text: text.slice(0, 200_000) };
}

export async function scrapeSource(sourceId: string): Promise<void> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) return;
  if (source.kind === 'LINKEDIN' || source.kind === 'MANUAL' || source.kind === 'SAMPLE_POST' || !source.url) {
    await prisma.source.update({ where: { id: sourceId }, data: { status: source.content ? 'OK' : 'ERROR', error: source.content ? null : 'Paste the content for this source', lastCrawledAt: new Date() } });
    if (source.content) await embedKnowledge('SOURCE', sourceId);
    return;
  }
  try {
    const { title, text } = await extractReadable(source.url);
    await prisma.source.update({
      where: { id: sourceId },
      data: { title: source.title || title, content: text, status: 'OK', error: null, lastCrawledAt: new Date() },
    });
    const chunks = await embedKnowledge('SOURCE', sourceId);
    await recordEvent({ actorId: null, verb: 'scrape', entityType: 'source', entityId: sourceId, summary: `Knowledge source "${source.title || title}" read (${chunks} passages)`, link: '/knowledge/sources' });
  } catch (err) {
    await prisma.source.update({ where: { id: sourceId }, data: { status: 'ERROR', error: (err as Error).message, lastCrawledAt: new Date() } });
  }
}

/**
 * Keeps one Source per product link: new links are read, removed links are dropped from the
 * Knowledge Base, and existing ones are refreshed.
 */
export async function scrapeProductLinks(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  const links = product ? [...new Set(product.links)] : [];
  const current = await prisma.source.findMany({ where: { productId } });
  for (const s of current.filter((s) => !s.url || !links.includes(s.url))) {
    await prisma.source.delete({ where: { id: s.id } });
    await embedKnowledge('SOURCE', s.id);
  }
  for (const url of links) {
    const existing = current.find((s) => s.url === url);
    const s =
      existing ??
      (await prisma.source.create({ data: { organizationId: product!.organizationId, url, kind: isLinkedIn(url) ? 'LINKEDIN' : 'WEBSITE', productId, title: `${product!.name}: ${url}`, recrawlDays: 30 } }));
    await scrapeSource(s.id);
  }
}

/** Sources that opted into re-crawling and are due. */
export async function dueRecrawlSourceIds(orgId?: string): Promise<string[]> {
  const sources = await prisma.source.findMany({ where: { organizationId: orgId, recrawlDays: { not: null }, url: { not: null }, kind: { notIn: ['SAMPLE_POST', 'MANUAL', 'DOCUMENT'] } } });
  const now = Date.now();
  return sources
    .filter((s) => !s.lastCrawledAt || now - s.lastCrawledAt.getTime() > s.recrawlDays! * 86_400_000)
    .map((s) => s.id);
}
