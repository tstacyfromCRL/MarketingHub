import { prisma } from '@mh/db';
import {
  PLATFORM_PRESETS,
  newLayerId,
  paletteInOrder,
  type ContentType,
  type DesignDoc,
  type Layer,
  type Platform,
} from '@mh/shared';
import { generateImage, generateText, parseJson } from './ai/providers';
import { brandProfile, retrieve } from './knowledge';
import { newStorageKey, storage } from './storage';

const TYPE_INSTRUCTIONS: Record<ContentType, string> = {
  SOCIAL_POST: 'Write one social media post. Hook in the first line, concrete benefit, clear call to action, and 2-5 relevant hashtags at the end.',
  EMAIL: 'Write a marketing email. First line: "Subject: ...". Second line: "Preview: ...". Then the body with a greeting, short paragraphs, one clear call to action and a sign-off.',
  BLOG: 'Write a blog post in Markdown: an H1 title, a short intro, 3-5 H2 sections, and a conclusion with a call to action. About 700-900 words.',
  DOCUMENTATION: 'Write product documentation in Markdown: an overview, prerequisites if relevant, numbered steps, and a troubleshooting/FAQ section. Be precise and neutral in tone.',
};

export interface BrandContext {
  system: string;
  facts: string[];
  companyName: string;
  palette: string[];
  headingFont: string;
  bodyFont: string;
  productNames: string[];
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/**
 * Up to `max` past posts to imitate: same-platform samples first, then the ones sharing the most
 * words with the brief.
 */
async function styleExamples(brief: string, platform: Platform | undefined, max = 3): Promise<{ ids: Set<string>; texts: string[] }> {
  const samples = await prisma.source.findMany({ where: { kind: 'SAMPLE_POST' }, orderBy: { createdAt: 'desc' }, take: 60 });
  const briefWords = words(brief);
  const scored = samples
    .filter((s) => s.content.trim())
    .map((s) => {
      const overlap = [...words(s.content)].filter((w) => briefWords.has(w)).length;
      return { s, score: (platform && s.platform === platform ? 100 : 0) + overlap };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  return { ids: new Set(samples.map((s) => s.id)), texts: scored.map(({ s }) => `${s.platform ? `(${s.platform}) ` : ''}${s.content.trim().slice(0, 1200)}`) };
}

const productFact = (p: { name: string; description: string; features: string[]; pricing: string; url: string }) =>
  `Product ${p.name}: ${p.description}${p.features.length ? ` Features: ${p.features.join('; ')}.` : ''}${p.pricing ? ` Pricing: ${p.pricing}.` : ''}${p.url ? ` URL: ${p.url}` : ''}`;

/** System prompt from the brand profile plus retrieved knowledge relevant to the brief. */
export async function buildBrandContext(brief: string, productIds: string[] = [], platform?: Platform): Promise<BrandContext> {
  const brand = await brandProfile();
  const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
  const [retrieved, examples] = await Promise.all([
    retrieve([brief, ...products.map((p) => p.name)].join(' '), 10).catch(() => []),
    styleExamples(brief, platform),
  ]);
  const facts = [
    ...products.map(productFact),
    // Sample posts teach style only; their claims may be out of date.
    ...retrieved.filter((r) => !(r.sourceType === 'SOURCE' && examples.ids.has(r.sourceId))).slice(0, 8).map((r) => r.text),
  ];
  const name = brand.companyName || 'the company';
  const system = [
    `You are the in-house marketing writer for ${name}.${brand.tagline ? ` Tagline: "${brand.tagline}".` : ''}`,
    brand.summary && `About ${name}:\n${brand.summary}`,
    brand.mission && `Mission: ${brand.mission}`,
    brand.audience && `Target audience: ${brand.audience}`,
    brand.voice && `Brand voice: ${brand.voice}`,
    brand.dos.length ? `Always: ${brand.dos.join('; ')}` : '',
    brand.donts.length ? `Never: ${brand.donts.join('; ')}` : '',
    examples.texts.length
      ? `Style references: past posts written by the team. Match their tone, rhythm, length and emoji/hashtag habits. ` +
        `Do not copy their wording or reuse their facts.\n${examples.texts.map((t, i) => `--- Example ${i + 1}\n${t}`).join('\n')}`
      : '',
    'Only state facts that appear in the provided company knowledge. Do not invent statistics, prices, customers or awards.',
  ].filter(Boolean).join('\n\n');
  return {
    system,
    facts,
    companyName: name,
    palette: paletteInOrder(brand.colors),
    headingFont: brand.fonts.find((f) => /head|display|title/i.test(f.role))?.family ?? brand.fonts[0]?.family ?? 'Arial',
    bodyFont: brand.fonts.find((f) => /body|text/i.test(f.role))?.family ?? brand.fonts[0]?.family ?? 'Arial',
    productNames: products.map((p) => p.name),
  };
}

function knowledgeBlock(facts: string[]): string {
  return facts.length ? `Company knowledge:\n${facts.map((f) => `- ${f}`).join('\n')}` : 'Company knowledge: (none provided yet)';
}

export async function generateContent(input: {
  type: ContentType;
  brief: string;
  platform?: Platform;
  productIds?: string[];
  tone?: string;
}): Promise<string> {
  const ctx = await buildBrandContext(input.brief, input.productIds, input.platform);
  const preset = input.platform ? PLATFORM_PRESETS[input.platform] : null;
  const prompt = [
    TYPE_INSTRUCTIONS[input.type],
    preset && `Platform: ${preset.label}. Stay under ${preset.maxChars} characters.`,
    input.tone && `Tone for this piece: ${input.tone}`,
    knowledgeBlock(ctx.facts),
    `Brief: ${input.brief}`,
  ].filter(Boolean).join('\n\n');
  return generateText({
    system: ctx.system,
    prompt,
    maxTokens: input.type === 'BLOG' || input.type === 'DOCUMENTATION' ? 3000 : 800,
    mock: () => mockContent(input.type, input.brief, ctx, preset?.maxChars),
  });
}

function mockContent(type: ContentType, brief: string, ctx: BrandContext, maxChars?: number): string {
  const product = ctx.productNames[0] ?? ctx.companyName;
  const fact = ctx.facts[0]?.replace(/^\[[^\]]+\]\s*/, '').slice(0, 160);
  switch (type) {
    case 'SOCIAL_POST': {
      const text = `${brief.charAt(0).toUpperCase()}${brief.slice(1)}. ${fact ? `${fact} ` : ''}Discover what ${product} can do for you. Learn more today! #${ctx.companyName.replace(/\W/g, '')} #${product.replace(/\W/g, '')}`;
      return maxChars ? text.slice(0, maxChars) : text;
    }
    case 'EMAIL':
      return `Subject: ${brief}\nPreview: News from ${ctx.companyName}\n\nHi there,\n\n${brief}.${fact ? `\n\n${fact}` : ''}\n\nSee how ${product} can help.\n\n[Learn more]\n\nThe ${ctx.companyName} team`;
    case 'BLOG':
      return `# ${brief}\n\n${ctx.companyName} is always looking for better ways to serve our customers.\n\n## Why it matters\n\n${fact ?? 'Add company knowledge to make drafts more specific.'}\n\n## How ${product} helps\n\nDescribe the key benefits here.\n\n## Getting started\n\nOutline the next steps.\n\n## Conclusion\n\nReady to learn more? Get in touch with ${ctx.companyName} today.`;
    case 'DOCUMENTATION':
      return `# ${brief}\n\n## Overview\n\n${fact ?? `This guide covers ${product}.`}\n\n## Steps\n\n1. First step\n2. Second step\n3. Third step\n\n## Troubleshooting\n\n**Q:** Something isn't working?\n**A:** Contact ${ctx.companyName} support.`;
  }
}

/** Platform-specific versions of a post's copy, each within the platform's length limit. */
export async function adaptCopyForPlatforms(body: string, platforms: Platform[]): Promise<Record<string, string>> {
  if (platforms.length === 0) return {};
  const ctx = await buildBrandContext(body);
  const limits = platforms.map((p) => `${p}: max ${PLATFORM_PRESETS[p].maxChars} characters`).join('; ');
  const text = await generateText({
    system: ctx.system,
    json: true,
    prompt: `Adapt this social post for each platform (${limits}). Match each platform's conventions (e.g. LinkedIn professional, X concise, Instagram visual with hashtags). Keep facts identical.\n\nPost:\n${body}\n\nRespond as JSON: {"variants": {"<platform>": "<text>"}}`,
    mock: () => JSON.stringify({ variants: Object.fromEntries(platforms.map((p) => [p, body.slice(0, PLATFORM_PRESETS[p].maxChars)])) }),
  });
  const parsed = parseJson<{ variants?: Record<string, string> }>(text).variants ?? {};
  return Object.fromEntries(platforms.map((p) => [p, (parsed[p] ?? body).slice(0, PLATFORM_PRESETS[p].maxChars)]));
}

export interface PostIdea {
  title: string;
  body: string;
  headline: string;
  subline: string;
  imagePrompt: string;
}

/** Plans `count` distinct posts for a campaign. */
export async function generatePostIdeas(input: { brief: string; count: number; productIds: string[]; platforms: Platform[]; startDate: string; endDate: string }): Promise<PostIdea[]> {
  const ctx = await buildBrandContext(input.brief, input.productIds, input.platforms.length === 1 ? input.platforms[0] : undefined);
  const ideas: PostIdea[] = [];
  const batch = 10;
  while (ideas.length < input.count) {
    const n = Math.min(batch, input.count - ideas.length);
    const already = ideas.map((i) => `- ${i.title}`).join('\n');
    const text = await generateText({
      system: ctx.system,
      json: true,
      maxTokens: 4000,
      prompt: [
        `Plan ${n} distinct social media posts for a campaign running ${input.startDate} to ${input.endDate} on ${input.platforms.join(', ')}.`,
        'Vary the angle (education, social proof, product feature, behind the scenes, offer, question/engagement).',
        already && `Already planned (do not repeat):\n${already}`,
        knowledgeBlock(ctx.facts),
        `Campaign brief: ${input.brief}`,
        'For each post give: title (internal, short), body (the post copy with hashtags), headline (max 8 words, for the graphic), subline (max 14 words), imagePrompt (a photographic/illustrative scene description for an image generator, no text in the image).',
        'Respond as JSON: {"posts": [{"title","body","headline","subline","imagePrompt"}]}',
      ].filter(Boolean).join('\n\n'),
      mock: () =>
        JSON.stringify({
          posts: Array.from({ length: n }, (_, i) => {
            const k = ideas.length + i + 1;
            const angle = ['Tip', 'Spotlight', 'Behind the scenes', 'Customer story', 'Question', 'Offer'][k % 6];
            return {
              title: `${angle} #${k}`,
              body: mockContent('SOCIAL_POST', `${angle}: ${input.brief}`, ctx),
              headline: `${angle}: ${ctx.productNames[0] ?? ctx.companyName}`,
              subline: input.brief.slice(0, 80),
              imagePrompt: `${angle.toLowerCase()} scene about ${input.brief}`,
            };
          }),
        }),
    });
    const posts = parseJson<{ posts?: Partial<PostIdea>[] }>(text).posts ?? [];
    if (posts.length === 0) throw new Error('The AI returned no posts');
    for (const p of posts.slice(0, n)) {
      ideas.push({
        title: String(p.title ?? `Post ${ideas.length + 1}`),
        body: String(p.body ?? ''),
        headline: String(p.headline ?? p.title ?? ''),
        subline: String(p.subline ?? ''),
        imagePrompt: String(p.imagePrompt ?? input.brief),
      });
    }
  }
  return ideas;
}

/** Generates an image, stores it, and records it as a GENERATED brand file. Returns the storage key. */
export async function generateAndStoreImage(prompt: string, width: number, height: number, palette: string[] = []): Promise<string> {
  const brand = await brandProfile();
  const fullPrompt = [prompt, brand.visualIdentity && `Visual style: ${brand.visualIdentity}`, 'No text, letters or logos in the image.'].filter(Boolean).join('. ');
  const png = await generateImage(fullPrompt, width, height, palette);
  const key = newStorageKey('generated', 'png');
  await storage.put(key, png, 'image/png');
  await prisma.brandFile.create({ data: { kind: 'GENERATED', name: prompt.slice(0, 80), storageKey: key, mime: 'image/png', size: png.length } });
  return key;
}

export interface ComposeInput {
  headline: string;
  subline?: string;
  platform: Platform;
  imagePrompt?: string;
  /** Storage key of a product photo from the library, if any. */
  productImageKey?: string;
  /** Pre-generated background, reused across platform sizes of the same post. */
  backgroundKey?: string;
  sizeOverride?: { width: number; height: number };
}

/**
 * Builds an editable, layered design: AI background, brand-colored band, product photo,
 * logo, headline and subline, laid out for the platform's aspect ratio.
 */
export async function composeDesign(input: ComposeInput): Promise<{ doc: DesignDoc; backgroundKey?: string }> {
  const preset = PLATFORM_PRESETS[input.platform];
  const W = input.sizeOverride?.width ?? preset.width;
  const H = input.sizeOverride?.height ?? preset.height;
  const ctx = await buildBrandContext(input.headline);
  const primary = ctx.palette[0] ?? '#1e293b';
  const accent = ctx.palette[1] ?? '#f59e0b';
  const layers: Layer[] = [];
  const base = { rotation: 0, opacity: 1, visible: true, locked: false };

  let backgroundKey = input.backgroundKey;
  if (!backgroundKey && input.imagePrompt) {
    backgroundKey = await generateAndStoreImage(input.imagePrompt, W, H, ctx.palette);
  }
  if (backgroundKey) {
    layers.push({ ...base, id: newLayerId(), name: 'AI Image', type: 'image', src: backgroundKey, x: 0, y: 0, width: W, height: H, fit: 'cover', role: 'generated' });
  }

  const portrait = H > W * 1.1;
  const bandH = Math.round(H * (portrait ? 0.32 : 0.38));
  const bandY = H - bandH;
  layers.push({ ...base, id: newLayerId(), name: 'Color Band', type: 'rect', x: 0, y: bandY, width: W, height: bandH, fill: primary, opacity: 0.88, cornerRadius: 0, strokeWidth: 0 });
  layers.push({ ...base, id: newLayerId(), name: 'Accent Bar', type: 'rect', x: Math.round(W * 0.06), y: bandY - 6, width: Math.round(W * 0.18), height: 12, fill: accent, cornerRadius: 6, strokeWidth: 0 });

  if (input.productImageKey) {
    const size = Math.round(Math.min(W, H) * 0.42);
    layers.push({
      ...base, id: newLayerId(), name: 'Product', type: 'image', src: input.productImageKey,
      x: W - size - Math.round(W * 0.06), y: Math.max(20, bandY - size - 20), width: size, height: size, fit: 'contain', role: 'product',
    });
  }

  const logo = await prisma.brandFile.findFirst({ where: { kind: 'LOGO' }, orderBy: { createdAt: 'desc' } });
  if (logo) {
    const lw = Math.round(W * 0.18);
    layers.push({ ...base, id: newLayerId(), name: 'Logo', type: 'image', src: logo.storageKey, x: Math.round(W * 0.05), y: Math.round(H * 0.05), width: lw, height: Math.round(lw * 0.5), fit: 'contain', role: 'logo' });
  }

  const pad = Math.round(W * 0.06);
  const headSize = Math.round(Math.min(W, H) * (portrait ? 0.07 : 0.075));
  layers.push({
    ...base, id: newLayerId(), name: 'Headline', type: 'text', text: input.headline,
    x: pad, y: bandY + Math.round(bandH * 0.14), width: W - pad * 2, height: Math.round(bandH * 0.5),
    fontFamily: ctx.headingFont, fontSize: headSize, fontWeight: 'bold', italic: false, color: '#ffffff', align: 'left', lineHeight: 1.15,
  });
  if (input.subline) {
    const subSize = Math.round(headSize * 0.48);
    layers.push({
      ...base, id: newLayerId(), name: 'Subline', type: 'text', text: input.subline,
      x: pad, y: bandY + Math.round(bandH * 0.66), width: W - pad * 2, height: Math.round(bandH * 0.3),
      fontFamily: ctx.bodyFont, fontSize: subSize, fontWeight: 'normal', italic: false, color: '#e2e8f0', align: 'left', lineHeight: 1.25,
    });
  }

  return { doc: { version: 1, width: W, height: H, background: primary, layers }, backgroundKey };
}
