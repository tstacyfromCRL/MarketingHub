/** Shown on competitor and partner passages so a draft does not quote them as our facts. */
export const MARKET_CONTEXT_NOTE =
  'Market context, not our company. Do not treat this as our product, our price, or our claim.';

const SOCIAL_HOSTS: { pattern: RegExp; channel: string }[] = [
  { pattern: /(^|\.)linkedin\.com$/, channel: 'linkedin' },
  { pattern: /(^|\.)facebook\.com$/, channel: 'facebook' },
  { pattern: /(^|\.)instagram\.com$/, channel: 'instagram' },
  { pattern: /(^|\.)(x\.com|twitter\.com)$/, channel: 'x' },
  { pattern: /(^|\.)(youtube\.com|youtu\.be)$/, channel: 'youtube' },
  { pattern: /(^|\.)tiktok\.com$/, channel: 'tiktok' },
];

/** Website pages can be read. Social hosts usually block a fetch, so we keep the link itself. */
export function marketChannel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_HOSTS.find((row) => row.pattern.test(host))?.channel ?? 'website';
  } catch {
    return 'website';
  }
}

export function isSocialChannel(channel: string): boolean {
  return channel !== 'website';
}

const DOC_LINK_KINDS = new Set(['WEBSITE', 'ARTICLE', 'LINKEDIN']);

/**
 * Pages created from a product's documentation links.
 * Uploaded files and competitor or partner pages stay put when that link list changes.
 */
export function isProductDocumentationLink(source: { origin: string; kind: string }): boolean {
  if (source.origin === 'product-link') return true;
  return source.origin === 'manual' && DOC_LINK_KINDS.has(source.kind);
}

export function marketKnowledgeText(links: { role: 'COMPETITOR' | 'PARTNER'; name: string; url: string }[]): string {
  const line = (role: 'COMPETITOR' | 'PARTNER', label: string) => {
    const rows = links.filter((link) => link.role === role);
    return rows.length ? `${label}, not our company: ${rows.map((link) => `${link.name} (${link.url})`).join('; ')}` : '';
  };
  return [line('COMPETITOR', 'Competitors'), line('PARTNER', 'Partners')].filter(Boolean).join('\n');
}

/** The product passage the writer is allowed to treat as ours. */
export function productKnowledgeText(product: {
  name: string;
  sku?: string;
  partNumbers?: string[];
  description?: string;
  usage?: string;
  features?: string[];
  pricing?: string;
  url?: string;
  competitors?: { name: string; url: string }[];
  partners?: { name: string; url: string }[];
}): string {
  const partNumbers = [...new Set([product.sku, ...(product.partNumbers ?? [])].map((part) => part?.trim()).filter(Boolean))];
  return [
    `Product: ${product.name}${partNumbers.length ? ` (part numbers ${partNumbers.join(', ')})` : ''}`,
    product.description?.trim() && `What it does: ${product.description.trim()}`,
    product.usage?.trim() && `How it is used: ${product.usage.trim()}`,
    product.features?.length ? `Features: ${product.features.join('; ')}` : '',
    product.pricing?.trim() && `Price: ${product.pricing.trim()}`,
    product.url?.trim() && `URL: ${product.url.trim()}`,
    marketKnowledgeText([
      ...(product.competitors ?? []).map((link) => ({ role: 'COMPETITOR' as const, ...link })),
      ...(product.partners ?? []).map((link) => ({ role: 'PARTNER' as const, ...link })),
    ]),
  ]
    .filter(Boolean)
    .join('\n');
}
