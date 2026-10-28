import { prisma } from '@mh/db';
import { config } from '../config';
import { decrypt } from '../crypto';
import { contentHash } from '../hash';
import { enqueue } from '../queue';
import { connectorById, productConnectors } from './registry';
import type { NormalizedProduct } from './types';

/** Connector-owned fields. Pack-owned features, positioning and links are left in place. */
function connectorHash(product: NormalizedProduct): string {
  return contentHash({ name: product.name, sku: product.sku, description: product.description, pricing: product.pricing, url: product.url, active: product.active });
}

export async function upsertConnectorProduct(orgId: string, connectorId: string, product: NormalizedProduct): Promise<'created' | 'updated' | 'unchanged'> {
  const externalKey = `${connectorId}:${product.externalId}`;
  const sku = product.sku.trim();
  const byKey = await prisma.product.findFirst({
    where: { organizationId: orgId, OR: [{ externalKey }, { connectorKey: externalKey }] },
  });
  const bySku = !byKey && sku
    ? await prisma.product.findFirst({ where: { organizationId: orgId, sku, NOT: { sku: '' } } })
    : null;
  const existing = byKey ?? bySku;
  const hash = connectorHash(product);
  if (!existing) {
    const created = await prisma.product.create({
      data: {
        organizationId: orgId,
        name: product.name,
        sku: product.sku,
        description: product.description,
        features: product.features,
        url: product.url,
        pricing: product.pricing,
        active: product.active,
        externalKey,
        connectorKey: externalKey,
        origin: 'connector',
        contentHash: hash,
        lastSyncedAt: new Date(),
      },
    });
    await enqueue('embed-knowledge', { orgId, sourceType: 'PRODUCT', sourceId: created.id });
    return 'created';
  }
  // A pack row that shares a SKU keeps its features, positioning and links.
  const fromPack = existing.origin === 'pack';
  const same = existing.contentHash === hash && existing.connectorKey === externalKey && existing.active === product.active;
  if (same && !fromPack) return 'unchanged';
  await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: product.name,
      sku: product.sku || existing.sku,
      description: product.description,
      url: product.url,
      pricing: product.pricing,
      active: product.active,
      connectorKey: externalKey,
      lastSyncedAt: new Date(),
      contentHash: fromPack ? existing.contentHash : hash,
      features: fromPack ? (existing.packFeatures.length ? existing.packFeatures : existing.features) : product.features.length ? product.features : existing.features,
      links: fromPack ? (existing.packLinks.length ? existing.packLinks : existing.links) : existing.links,
    },
  });
  await enqueue('embed-knowledge', { orgId, sourceType: 'PRODUCT', sourceId: existing.id });
  return 'updated';
}

export async function syncConnector(orgId: string, connectorId: string, rawConfig: unknown): Promise<{ created: number; updated: number; unchanged: number; archived: number }> {
  const connector = connectorById(connectorId);
  if (!connector) throw new Error(`Unknown connector ${connectorId}`);
  const parsed = connector.configSchema.parse(rawConfig);
  const seen = new Set<string>();
  const report = { created: 0, updated: 0, unchanged: 0, archived: 0 };
  for await (const product of connector.fetchProducts(parsed)) {
    seen.add(`${connectorId}:${product.externalId}`);
    const result = await upsertConnectorProduct(orgId, connectorId, product);
    report[result] += 1;
  }
  if (seen.size === 0 && connectorId === 'csv' && !parsed.inlineText) return report;
  const owned = await prisma.product.findMany({
    where: { organizationId: orgId, connectorKey: { startsWith: `${connectorId}:` }, active: true },
    select: { id: true, connectorKey: true },
  });
  for (const row of owned) {
    if (row.connectorKey && !seen.has(row.connectorKey)) {
      await prisma.product.update({ where: { id: row.id }, data: { active: false, lastSyncedAt: new Date() } });
      await enqueue('embed-knowledge', { orgId, sourceType: 'PRODUCT', sourceId: row.id });
      report.archived += 1;
    }
  }
  return report;
}

/** Runs every enabled connector for the org. Shopify falls back to env for the default org only. */
export async function syncProducts(orgId: string, only?: { connectorId: string; inlineText?: string; format?: 'csv' | 'json' }): Promise<Record<string, unknown>> {
  if (only?.connectorId === 'csv' && only.inlineText) {
    return { csv: await syncConnector(orgId, 'csv', { format: only.format ?? 'csv', inlineText: only.inlineText }) };
  }
  const settings = await prisma.integrationSetting.findMany({ where: { organizationId: orgId } });
  const reports: Record<string, unknown> = {};
  for (const setting of settings) {
    if (!setting.enabled) continue;
    if (only && setting.connectorId !== only.connectorId) continue;
    if (setting.connectorId === 'csv') continue;
    const raw = JSON.parse(decrypt(setting.configEncrypted)) as unknown;
    reports[setting.connectorId] = await syncConnector(orgId, setting.connectorId, raw);
  }
  // A saved disabled setting wins over the environment, so turning Shopify off stays off.
  const shopifySaved = settings.some((s) => s.connectorId === 'shopify');
  if (!shopifySaved && !only && config.SHOPIFY_STORE_DOMAIN && config.SHOPIFY_ADMIN_TOKEN) {
    const { getDefaultOrgId } = await import('../org');
    if (orgId === (await getDefaultOrgId())) {
      reports.shopify = await syncConnector(orgId, 'shopify', {
        storeDomain: config.SHOPIFY_STORE_DOMAIN,
        adminToken: config.SHOPIFY_ADMIN_TOKEN,
        apiVersion: config.SHOPIFY_API_VERSION,
      });
    }
  }
  return reports;
}

export function listConnectorMeta() {
  return productConnectors.map((connector) => ({ id: connector.id, displayName: connector.displayName, secretFields: connector.secretFields }));
}
