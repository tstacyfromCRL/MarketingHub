import { prisma, toVector, type Sensitivity } from '@mh/db';
import { brandColorsSchema, MARKET_CONTEXT_NOTE, productKnowledgeText, type BrandProfileInput } from '@mh/shared';
import { embedTexts } from './ai/providers';
import { getDefaultOrgId } from './org';

export type KnowledgeSourceType = 'BRAND' | 'PRODUCT' | 'ACCOMPLISHMENT' | 'SOURCE' | 'CLAIM';

export interface BrandProfileRecord extends BrandProfileInput {
  id: string;
  organizationId: string;
}

/** Splits text into ~`size` character chunks on paragraph/sentence boundaries with overlap. */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+|\n\n/);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + ' ' + s).length > size && current) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap)) + ' ' + s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** The brand profile for an org. Defaults to the one company this server runs for. */
export async function brandProfile(orgId?: string): Promise<BrandProfileRecord> {
  const organizationId = orgId ?? (await getDefaultOrgId());
  const p = await prisma.brandProfile.upsert({ where: { organizationId }, update: {}, create: { organizationId, dos: [], donts: [] } });
  const colors = brandColorsSchema.safeParse(p.colors);
  return {
    id: p.id,
    organizationId,
    companyName: p.companyName,
    summary: p.summary,
    website: p.website,
    tagline: p.tagline,
    mission: p.mission,
    voice: p.voice,
    visualIdentity: p.visualIdentity,
    audience: p.audience,
    colors: colors.success ? colors.data : [],
    fonts: (p.fonts as BrandProfileInput['fonts']) ?? [],
    dos: p.dos,
    donts: p.donts,
  };
}

interface ParentMeta {
  organizationId: string;
  sensitivity: Sensitivity;
  label: string;
  text: string;
}

async function parentFor(sourceType: KnowledgeSourceType, sourceId: string): Promise<ParentMeta | null> {
  switch (sourceType) {
    case 'BRAND': {
      const row = await prisma.brandProfile.findUnique({ where: { id: sourceId } });
      if (!row) return null;
      const b = await brandProfile(row.organizationId);
      return {
        organizationId: row.organizationId,
        sensitivity: 'PUBLIC',
        label: 'Brand profile',
        text: [
          b.companyName && `Company: ${b.companyName}`,
          b.summary && `About the company: ${b.summary}`,
          b.website && `Website: ${b.website}`,
          b.tagline && `Tagline: ${b.tagline}`,
          b.mission && `Mission: ${b.mission}`,
          b.audience && `Audience: ${b.audience}`,
          b.voice && `Brand voice: ${b.voice}`,
          b.visualIdentity && `Visual identity: ${b.visualIdentity}`,
        ].filter(Boolean).join('\n'),
      };
    }
    case 'PRODUCT': {
      const p = await prisma.product.findUnique({ where: { id: sourceId } });
      if (!p || !p.active) return null;
      const markets = await prisma.marketLink.findMany({ where: { productId: p.id } });
      return {
        organizationId: p.organizationId,
        sensitivity: p.sensitivity,
        label: `Product: ${p.name}`,
        text: productKnowledgeText({
          name: p.name,
          sku: p.sku,
          partNumbers: p.partNumbers,
          description: p.description,
          usage: p.usage,
          features: p.features,
          pricing: p.pricing,
          url: p.url,
          competitors: markets.filter((link) => link.role === 'COMPETITOR'),
          partners: markets.filter((link) => link.role === 'PARTNER'),
        }),
      };
    }
    case 'ACCOMPLISHMENT': {
      const a = await prisma.accomplishment.findUnique({ where: { id: sourceId } });
      if (!a) return null;
      return {
        organizationId: a.organizationId,
        sensitivity: a.sensitivity,
        label: `Accomplishment: ${a.title}`,
        text: `Accomplishment${a.date ? ` (${a.date.toISOString().slice(0, 10)})` : ''}: ${a.title}\n${a.description}`,
      };
    }
    case 'SOURCE': {
      const s = await prisma.source.findUnique({ where: { id: sourceId } });
      if (!s || !s.content) return null;
      return {
        organizationId: s.organizationId,
        sensitivity: s.sensitivity,
        label: s.title || s.url || 'Source',
        // Competitor and partner pages stay in search, but the label keeps them out of "our" claims.
        text: `${s.origin === 'market' ? `${MARKET_CONTEXT_NOTE}\n` : ''}${s.title ? `${s.title}\n` : ''}${s.content}`,
      };
    }
    case 'CLAIM': {
      const c = await prisma.claim.findUnique({ where: { id: sourceId } });
      if (!c || c.status !== 'APPROVED') return null;
      if (c.expiresAt && c.expiresAt.getTime() < Date.now()) return null;
      return {
        organizationId: c.organizationId,
        sensitivity: c.sensitivity,
        label: 'Approved claim',
        text: `Approved claim: ${c.text}${c.sourceUrl ? ` Source: ${c.sourceUrl}` : ''}`,
      };
    }
  }
}

/** Rebuilds the embedded chunks for one knowledge item. Restricted items are never embedded. Deleted items just lose their chunks. */
export async function embedKnowledge(sourceType: KnowledgeSourceType, sourceId: string): Promise<number> {
  await prisma.knowledgeChunk.deleteMany({ where: { sourceType, sourceId } });
  const item = await parentFor(sourceType, sourceId);
  // RESTRICTED material stays out of the index entirely.
  if (!item || !item.text.trim() || item.sensitivity === 'RESTRICTED') return 0;
  const chunks = chunkText(item.text).map((c) => `[${item.label}] ${c}`);
  const vectors = await embedTexts(chunks);
  for (let i = 0; i < chunks.length; i++) {
    const row = await prisma.knowledgeChunk.create({
      data: { organizationId: item.organizationId, sourceType, sourceId, text: chunks[i], sensitivity: item.sensitivity },
    });
    await prisma.$executeRawUnsafe(`UPDATE "KnowledgeChunk" SET embedding = $1::vector WHERE id = $2`, toVector(vectors[i]), row.id);
  }
  return chunks.length;
}

/** Widths currently stored on knowledge chunks. Empty when nothing has been embedded. */
export async function storedEmbedDims(): Promise<number[]> {
  const rows = await prisma.$queryRawUnsafe<{ dims: number }[]>(
    `SELECT DISTINCT vector_dims(embedding)::int AS dims FROM "KnowledgeChunk" WHERE embedding IS NOT NULL`,
  );
  return rows.map((row) => Number(row.dims)).sort((a, b) => a - b);
}

/** Re-embeds everything, e.g. after switching embedding providers. */
export async function reindexAllKnowledge(orgId?: string): Promise<void> {
  const organizationId = orgId ?? (await getDefaultOrgId());
  const where = { organizationId };
  for (const b of await prisma.brandProfile.findMany({ where, select: { id: true } })) await embedKnowledge('BRAND', b.id);
  for (const p of await prisma.product.findMany({ where, select: { id: true } })) await embedKnowledge('PRODUCT', p.id);
  for (const a of await prisma.accomplishment.findMany({ where, select: { id: true } })) await embedKnowledge('ACCOMPLISHMENT', a.id);
  for (const s of await prisma.source.findMany({ where: { ...where, status: 'OK' }, select: { id: true } })) await embedKnowledge('SOURCE', s.id);
  for (const c of await prisma.claim.findMany({ where: { ...where, status: 'APPROVED' }, select: { id: true } })) await embedKnowledge('CLAIM', c.id);
}

export interface RetrievedChunk {
  id: string;
  sourceType: string;
  sourceId: string;
  text: string;
  sensitivity: Sensitivity;
  score: number;
}

/** Top-k knowledge chunks for one org. Restricted chunks are never stored, and are excluded here too. */
export async function retrieve(orgId: string, query: string, k = 8): Promise<RetrievedChunk[]> {
  const [vec] = await embedTexts([query]);
  return prisma.$queryRawUnsafe<RetrievedChunk[]>(
    `SELECT id, "sourceType", "sourceId", text, sensitivity::text AS sensitivity, 1 - (embedding <=> $1::vector) AS score
       FROM "KnowledgeChunk"
      WHERE embedding IS NOT NULL AND vector_dims(embedding) = $2
        AND "organizationId" = $3
        AND sensitivity <> 'RESTRICTED'
      ORDER BY embedding <=> $1::vector
      LIMIT $4`,
    toVector(vec),
    vec.length,
    orgId,
    k,
  );
}
