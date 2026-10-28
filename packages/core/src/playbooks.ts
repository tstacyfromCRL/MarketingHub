import { prisma, type PromptTemplate } from '@mh/db';
import { PLATFORM_PRESETS, type Platform } from '@mh/shared';
import { contentHash } from './hash';

export interface PlaybookQuery {
  platform?: string | null;
  contentType?: string | null;
  pillar?: string | null;
}

const SOCIAL = 'Write one social media post. Hook in the first line, concrete benefit, clear call to action, and 2-5 relevant hashtags at the end.';

const TYPE_BODIES: Record<string, { name: string; body: string; hashtagMin?: number; hashtagMax?: number }> = {
  SOCIAL_POST: { name: 'Social post', body: SOCIAL, hashtagMin: 2, hashtagMax: 5 },
  EMAIL: {
    name: 'Email',
    body: 'Write a marketing email. First line: "Subject: ...". Second line: "Preview: ...". Then the body with a greeting, short paragraphs, one clear call to action and a sign-off.',
  },
  BLOG: {
    name: 'Blog',
    body: 'Write a blog post in Markdown: an H1 title, a short intro, 3-5 H2 sections, and a conclusion with a call to action. About 700-900 words.',
  },
  DOCUMENTATION: {
    name: 'Documentation',
    body: 'Write product documentation in Markdown: an overview, prerequisites if relevant, numbered steps, and a troubleshooting/FAQ section. Be precise and neutral in tone.',
  },
};

const PLATFORM_HINTS: Record<Platform, string> = {
  linkedin: 'Write for LinkedIn: professional, specific, and a little longer. Few emojis.',
  x: 'Write for X: concise. Lead with the point and stay short.',
  instagram: 'Write for Instagram: visual and conversational, with the hashtags at the end.',
  facebook: 'Write for Facebook: conversational, as if speaking to a customer.',
  tiktok: 'Write for TikTok: short, spoken, and easy to say out loud.',
  youtube: 'Write for YouTube: a clear description with the point in the first line.',
};

const IDEAS = 'Vary the angle across education, social proof, a product feature, behind the scenes, an offer, and a question that invites a reply.';

/** Most specific active template wins: platform + type + pillar, then platform + type, then type, then a blank fallback. */
export function pickPlaybook<T extends { platform: string | null; contentType: string | null; pillar: string | null; version: number; name: string }>(
  templates: T[],
  query: PlaybookQuery,
): T | null {
  const ranked = templates
    .map((template) => ({ template, score: scorePlaybook(template, query) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || b.template.version - a.template.version || a.template.name.localeCompare(b.template.name));
  return ranked[0]?.template ?? null;
}

function scorePlaybook(template: { platform: string | null; contentType: string | null; pillar: string | null }, query: PlaybookQuery): number {
  if (template.platform && template.platform !== (query.platform ?? null)) return -1;
  if (template.contentType && template.contentType !== (query.contentType ?? null)) return -1;
  if (template.pillar && template.pillar !== (query.pillar ?? null)) return -1;
  return (template.platform ? 4 : 0) + (template.contentType ? 2 : 0) + (template.pillar ? 1 : 0);
}

/** Generic instructions so generation still works before a company imports a pack. Existing rows are left alone. */
export async function ensureSeedPlaybooks(orgId: string): Promise<void> {
  const seeds: {
    externalKey: string;
    name: string;
    body: string;
    platform?: string;
    contentType?: string;
    hashtagMin?: number;
    hashtagMax?: number;
    maxChars?: number;
  }[] = [
    ...Object.entries(TYPE_BODIES).map(([contentType, row]) => ({
      externalKey: `seed:type:${contentType}`,
      contentType,
      ...row,
    })),
    ...(Object.keys(PLATFORM_PRESETS) as Platform[]).map((platform) => ({
      externalKey: `seed:platform:${platform}`,
      name: `${PLATFORM_PRESETS[platform].label} social post`,
      contentType: 'SOCIAL_POST',
      platform,
      body: `${SOCIAL}\n${PLATFORM_HINTS[platform]}`,
      hashtagMin: 2,
      hashtagMax: 5,
      maxChars: PLATFORM_PRESETS[platform].maxChars,
    })),
    {
      externalKey: 'seed:post-ideas',
      name: 'Campaign angles',
      contentType: 'CAMPAIGN_IDEAS',
      body: IDEAS,
    },
    {
      externalKey: 'seed:fallback',
      name: 'General',
      body: 'Write clearly in the brand voice. Only use facts from the company knowledge.',
    },
  ];
  for (const seed of seeds) {
    const hash = contentHash(seed);
    const existing = await prisma.promptTemplate.findUnique({
      where: { organizationId_externalKey: { organizationId: orgId, externalKey: seed.externalKey } },
    });
    if (existing) continue;
    await prisma.promptTemplate.create({
      data: {
        organizationId: orgId,
        externalKey: seed.externalKey,
        name: seed.name,
        body: seed.body,
        platform: seed.platform ?? null,
        contentType: seed.contentType ?? null,
        hashtagMin: seed.hashtagMin ?? null,
        hashtagMax: seed.hashtagMax ?? null,
        maxChars: seed.maxChars ?? null,
        origin: 'seed',
        contentHash: hash,
      },
    });
  }
}

export async function selectPlaybook(orgId: string, platform?: string | null, contentType?: string | null, pillar?: string | null): Promise<PromptTemplate | null> {
  await ensureSeedPlaybooks(orgId);
  const templates = await prisma.promptTemplate.findMany({ where: { organizationId: orgId, active: true } });
  return pickPlaybook(templates, { platform, contentType, pillar });
}
