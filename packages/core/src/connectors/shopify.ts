import { z } from 'zod';
import type { NormalizedProduct, ProductSourceConnector } from './types';

export const shopifyConfigSchema = z.object({
  storeDomain: z.string().min(1),
  adminToken: z.string().min(1),
  apiVersion: z.string().default('2024-10'),
});

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string | null;
  status?: string | null;
  tags?: string[];
  onlineStoreUrl?: string | null;
  variants?: { nodes?: { sku?: string | null; price?: string | null }[] };
}

/** Turns one Admin API product into the shape every connector shares. */
export function shopifyProductToNormalized(node: ShopifyProductNode, storeDomain: string): NormalizedProduct {
  const variant = node.variants?.nodes?.[0];
  const domain = storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    externalId: node.id,
    name: node.title,
    sku: variant?.sku ?? '',
    description: htmlToText(node.descriptionHtml ?? ''),
    pricing: variant?.price ? `$${variant.price}` : '',
    url: node.onlineStoreUrl || (node.handle ? `https://${domain}/products/${node.handle}` : ''),
    features: [],
    active: (node.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUERY = `query Products($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle descriptionHtml status tags onlineStoreUrl variants(first: 1) { nodes { sku price } } }
  }
}`;

async function* fetchShopify(config: z.infer<typeof shopifyConfigSchema>): AsyncIterable<NormalizedProduct> {
  const domain = config.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  let cursor: string | null = null;
  for (;;) {
    const res = await fetch(`https://${domain}/admin/api/${config.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.adminToken },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProductNode[] } }; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    const page = body.data?.products;
    if (!page) break;
    for (const node of page.nodes) yield shopifyProductToNormalized(node, domain);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
}

export const shopifyConnector: ProductSourceConnector = {
  id: 'shopify',
  displayName: 'Shopify',
  secretFields: ['adminToken'],
  configSchema: shopifyConfigSchema,
  fetchProducts: fetchShopify,
};
