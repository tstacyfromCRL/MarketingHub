import { prisma, toVector } from '@mh/db';
import { brandColorsSchema, type BrandProfileInput } from '@mh/shared';
import { embedTexts } from './ai/providers';

export type KnowledgeSourceType = 'BRAND' | 'PRODUCT' | 'ACCOMPLISHMENT' | 'SOURCE';

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

export async function brandProfile(): Promise<BrandProfileInput> {
  const p = await prisma.brandProfile.upsert({ where: { id: 'brand' }, update: {}, create: { id: 'brand', dos: [], donts: [] } });
  const colors = brandColorsSchema.safeParse(p.colors);
  return {
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

async function textFor(sourceType: KnowledgeSourceType, sourceId: string): Promise<{ label: string; text: string } | null> {
  switch (sourceType) {
    case 'BRAND': {
      const b = await brandProfile();
      return {
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
      return {
        label: `Product: ${p.name}`,
        text: [
          `Product: ${p.name}${p.sku ? ` (SKU ${p.sku})` : ''}`,
          p.description,
          p.features.length ? `Features: ${p.features.join('; ')}` : '',
          p.pricing && `Pricing: ${p.pricing}`,
          p.url && `URL: ${p.url}`,
        ]
          .filter(Boolean).join('\n'),
      };
    }
    case 'ACCOMPLISHMENT': {
      const a = await prisma.accomplishment.findUnique({ where: { id: sourceId } });
      if (!a) return null;
      return { label: `Accomplishment: ${a.title}`, text: `Accomplishment${a.date ? ` (${a.date.toISOString().slice(0, 10)})` : ''}: ${a.title}\n${a.description}` };
    }
    case 'SOURCE': {
      const s = await prisma.source.findUnique({ where: { id: sourceId } });
      if (!s || !s.content) return null;
      return { label: s.title || s.url || 'Source', text: `${s.title ? `${s.title}\n` : ''}${s.content}` };
    }
  }
}

/** Rebuilds the embedded chunks for one knowledge item. Deleted items just lose their chunks. */
export async function embedKnowledge(sourceType: KnowledgeSourceType, sourceId: string): Promise<number> {
  await prisma.knowledgeChunk.deleteMany({ where: { sourceType, sourceId } });
  const item = await textFor(sourceType, sourceId);
  if (!item || !item.text.trim()) return 0;
  const chunks = chunkText(item.text).map((c) => `[${item.label}] ${c}`);
  const vectors = await embedTexts(chunks);
  for (let i = 0; i < chunks.length; i++) {
    const row = await prisma.knowledgeChunk.create({ data: { sourceType, sourceId, text: chunks[i] } });
    await prisma.$executeRawUnsafe(`UPDATE "KnowledgeChunk" SET embedding = $1::vector WHERE id = $2`, toVector(vectors[i]), row.id);
  }
  return chunks.length;
}

/** Re-embeds everything, e.g. after switching embedding providers. */
export async function reindexAllKnowledge(): Promise<void> {
  await embedKnowledge('BRAND', 'brand');
  for (const p of await prisma.product.findMany({ select: { id: true } })) await embedKnowledge('PRODUCT', p.id);
  for (const a of await prisma.accomplishment.findMany({ select: { id: true } })) await embedKnowledge('ACCOMPLISHMENT', a.id);
  for (const s of await prisma.source.findMany({ where: { status: 'OK' }, select: { id: true } })) await embedKnowledge('SOURCE', s.id);
}

export interface RetrievedChunk {
  id: string;
  sourceType: string;
  sourceId: string;
  text: string;
  score: number;
}

/** Top-k knowledge chunks by cosine similarity to the query. */
export async function retrieve(query: string, k = 8): Promise<RetrievedChunk[]> {
  const [vec] = await embedTexts([query]);
  return prisma.$queryRawUnsafe<RetrievedChunk[]>(
    `SELECT id, "sourceType", "sourceId", text, 1 - (embedding <=> $1::vector) AS score
       FROM "KnowledgeChunk"
      WHERE embedding IS NOT NULL AND vector_dims(embedding) = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    toVector(vec),
    vec.length,
    k,
  );
}
