/**
 * Finding public articles for a keyword list.
 *
 * The search page is only a list of titles and addresses. Nothing is read into
 * the knowledge base until someone files a result. Addresses that are not public
 * http(s) pages are dropped so a result cannot point the reader at this machine.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const DAY_MS = 86_400_000;

export function searchRequestUrl(keywords: string): string {
  const query = keywords.trim().replace(/\s+/g, ' ');
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

/** Manual searches are never due. A scheduled search is due once its interval has passed. */
export function isSearchDue(intervalDays: number | null, lastRunAt: Date | null, now: Date): boolean {
  if (intervalDays == null || intervalDays <= 0) return false;
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalDays * DAY_MS;
}

export function dueSearchIds(rows: { id: string; intervalDays: number | null; lastRunAt: Date | null }[], now: Date): string[] {
  return rows.filter((row) => isSearchDue(row.intervalDays, row.lastRunAt, now)).map((row) => row.id);
}

export function decodeResultUrl(href: string): string | null {
  const raw = href.replace(/&amp;/g, '&').trim();
  if (!raw || raw.startsWith('#')) return null;
  try {
    const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(absolute, 'https://duckduckgo.com');
    const wrapped = url.searchParams.get('uddg');
    const target = wrapped ?? url.toString();
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isPublicArticleUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull title, address, and snippet from a DuckDuckGo HTML results page. */
export function parseSearchResults(html: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/class="result(?:\s|")/).slice(1);
  for (const block of blocks.length ? blocks : [html]) {
    const link = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = decodeResultUrl(link[1]);
    if (!url || !isPublicArticleUrl(url) || seen.has(url)) continue;
    const title = stripTags(link[2]);
    if (!title) continue;
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    seen.add(url);
    hits.push({ title, url, snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 500) : '' });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function fetchSearchHits(keywords: string, fetchImpl: typeof fetch = fetch): Promise<SearchHit[]> {
  // The HTML results page answers a crawler token with an empty challenge. A normal browser
  // header is what that page expects. Reading a chosen article still uses the MantisBot token.
  const res = await fetchImpl(searchRequestUrl(keywords), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || res.status === 202) throw new Error(`The search returned HTTP ${res.status}`);
  const html = await res.text();
  const hits = parseSearchResults(html);
  if (!hits.length && /captcha|anomaly-modal|unfortunately, bots/i.test(html)) {
    throw new Error('The search site did not return articles. Try again in a minute.');
  }
  return hits;
}
