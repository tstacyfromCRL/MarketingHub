import { prisma, toVector } from '@mh/db';
import { assetHiddenFromAi, normalizeImportPath, type LibraryImportKind } from '@mh/shared';
import { describeImage } from './ai/providers';
import { embedImage } from './ai/imageEmbed';
import { enqueue } from './queue';
import { storage } from './storage';

/** Cosine similarity above which an asset is suggested for a product. */
const MATCH_THRESHOLD = 0.82;

export async function libraryHolds(libraryId: string) {
  return prisma.libraryHold.findMany({ where: { libraryId }, select: { relPath: true, kind: true } });
}

/** Drops the embedding so matching and generated graphics cannot use a file that is not for public use. */
async function forgetForAi(assetId: string): Promise<void> {
  await prisma.asset.update({ where: { id: assetId }, data: { notForPublicUse: true, needsTagging: false } });
  await prisma.$executeRawUnsafe(`UPDATE "Asset" SET embedding = NULL WHERE id = $1`, assetId);
}

/**
 * Flags a file or a whole folder, or clears that flag. Assets under a flagged folder stay
 * hidden until every covering hold is removed. Clearing a flag sends thumbnails back through tagging.
 */
export async function setLibraryHold(libraryId: string, relPath: string, kind: LibraryImportKind, hidden: boolean): Promise<void> {
  const path = normalizeImportPath(relPath);
  if (hidden) {
    await prisma.libraryHold.upsert({
      where: { libraryId_relPath: { libraryId, relPath: path } },
      update: { kind },
      create: { libraryId, relPath: path, kind },
    });
  } else {
    await prisma.libraryHold.deleteMany({ where: { libraryId, relPath: path } });
  }
  const holds = await libraryHolds(libraryId);
  const where = kind === 'FILE' || path === ''
    ? path === '' && kind === 'FOLDER'
      ? { libraryId }
      : { libraryId, relPath: { equals: path, mode: 'insensitive' as const } }
    : {
        libraryId,
        OR: [
          { relPath: { equals: path, mode: 'insensitive' as const } },
          { relPath: { startsWith: `${path}/`, mode: 'insensitive' as const } },
        ],
      };
  const assets = await prisma.asset.findMany({ where, select: { id: true, relPath: true, notForPublicUse: true, thumbnailKey: true } });
  for (const asset of assets) {
    if (assetHiddenFromAi(asset.relPath, holds)) {
      await forgetForAi(asset.id);
    } else if (asset.notForPublicUse) {
      await prisma.asset.update({ where: { id: asset.id }, data: { notForPublicUse: false, needsTagging: Boolean(asset.thumbnailKey) } });
      if (asset.thumbnailKey) await enqueue('tag-asset', { assetId: asset.id });
    }
  }
}

/** Vision tags + image embedding for one asset, then product matching. */
export async function tagAsset(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  const holds = await libraryHolds(asset.libraryId);
  if (asset.notForPublicUse || assetHiddenFromAi(asset.relPath, holds)) {
    await forgetForAi(asset.id);
    return;
  }
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
  if (!asset || asset.notForPublicUse) return;
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
         WHERE ap."productId" = $1 AND ap.confirmed = true AND a.embedding IS NOT NULL AND NOT a."notForPublicUse"
     ) WHERE id = $1`,
    productId,
  );
}

export async function rematchProducts(productId?: string): Promise<void> {
  if (productId) await recomputeProductCentroid(productId);
  const assets = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Asset" WHERE embedding IS NOT NULL AND NOT missing AND NOT "notForPublicUse"`);
  for (const a of assets) await matchAssetToProducts(a.id);
}
