import { prisma, toVector } from '@mh/db';
import { describeImage } from './ai/providers';
import { embedImage } from './ai/imageEmbed';
import { storage } from './storage';

/** Cosine similarity above which an asset is suggested for a product. */
const MATCH_THRESHOLD = 0.82;

/** Vision tags + image embedding for one asset, then product matching. */
export async function tagAsset(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  const key = asset.thumbnailKey;
  if (!key) {
    await prisma.asset.update({ where: { id: assetId }, data: { needsTagging: false } });
    return;
  }
  const png = await storage.get(key);
  const [vision, embedding] = await Promise.all([describeImage(png, asset.relPath), embedImage(png)]);
  await prisma.asset.update({
    where: { id: assetId },
    data: { description: vision.description, tags: vision.tags, needsTagging: false },
  });
  await prisma.$executeRawUnsafe(`UPDATE "Asset" SET embedding = $1::vector WHERE id = $2`, toVector(embedding), assetId);
  await matchAssetToProducts(assetId);
}

/**
 * Suggests products for an asset by (a) similarity to each product's centroid of confirmed
 * images and (b) the product name/SKU appearing in the file path or tags. User decisions
 * (confirmed true/false) are never overwritten.
 */
export async function matchAssetToProducts(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { products: true } });
  if (!asset) return;
  const decided = new Set(asset.products.filter((p) => p.confirmed !== null).map((p) => p.productId));
  const suggestions = new Map<string, number>();

  const similar = await prisma.$queryRawUnsafe<{ id: string; sim: number }[]>(
    `SELECT p.id, 1 - (p.centroid <=> a.embedding) AS sim
       FROM "Product" p, "Asset" a
      WHERE a.id = $1 AND p.active AND p.centroid IS NOT NULL AND a.embedding IS NOT NULL
        AND vector_dims(p.centroid) = vector_dims(a.embedding)`,
    assetId,
  );
  for (const s of similar) if (s.sim >= MATCH_THRESHOLD) suggestions.set(s.id, s.sim);

  const haystack = `${asset.relPath} ${asset.tags.join(' ')} ${asset.description}`.toLowerCase();
  const products = await prisma.product.findMany({ where: { active: true } });
  for (const p of products) {
    const needles = [p.name, p.sku].filter((n) => n && n.length >= 3).map((n) => n.toLowerCase());
    if (needles.some((n) => haystack.includes(n) || haystack.includes(n.replace(/\s+/g, '-')) || haystack.includes(n.replace(/\s+/g, '_')))) {
      suggestions.set(p.id, Math.max(suggestions.get(p.id) ?? 0, 0.9));
    }
  }

  await prisma.assetProduct.deleteMany({ where: { assetId, confirmed: null, productId: { notIn: [...suggestions.keys()] } } });
  for (const [productId, similarity] of suggestions) {
    if (decided.has(productId)) continue;
    await prisma.assetProduct.upsert({
      where: { assetId_productId: { assetId, productId } },
      update: { similarity },
      create: { assetId, productId, similarity, confirmed: null },
    });
  }
}

/** Product centroid = mean embedding of its user-confirmed images. Confirmations improve future matches. */
export async function recomputeProductCentroid(productId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Product" SET centroid = (
        SELECT AVG(a.embedding) FROM "Asset" a
          JOIN "AssetProduct" ap ON ap."assetId" = a.id
         WHERE ap."productId" = $1 AND ap.confirmed = true AND a.embedding IS NOT NULL
     ) WHERE id = $1`,
    productId,
  );
}

export async function rematchProducts(productId?: string): Promise<void> {
  if (productId) await recomputeProductCentroid(productId);
  const assets = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Asset" WHERE embedding IS NOT NULL AND NOT missing`);
  for (const a of assets) await matchAssetToProducts(a.id);
}
