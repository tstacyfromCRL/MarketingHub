import { JSDOM, VirtualConsole } from 'jsdom';
import sharp from 'sharp';
import { prisma } from '@mh/db';
import {
  companySummarySchema,
  onboardingStateSchema,
  suggestedProductSchema,
  type AnalyzeProgress,
  type AnalyzeStep,
  type CompanySummary,
  type OnboardingState,
  type SuggestedProduct,
} from '@mh/shared';
import { describeImage, generateText, parseJson } from './ai/providers';
import { bus } from './bus';
import { brandProfile, embedKnowledge } from './knowledge';
import { extractReadable, isLinkedIn } from './scrape';
import { storage } from './storage';

const ONBOARDING_KEY = 'onboarding';
const ANALYSIS_KEY = 'brandAnalysis';
const MAX_EXTRA_PAGES = 5;
const INTERESTING_PAGE = /about|company|who-we|what-we|story|mission|product|service|solution|pricing|plans|feature|industr|capabilit|team/i;

// ---------------------------------------------------------------------------
// Setup progress
// ---------------------------------------------------------------------------

async function getSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

async function putSetting(key: string, value: unknown): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
}

export async function onboardingState(): Promise<OnboardingState> {
  const parsed = onboardingStateSchema.safeParse((await getSetting(ONBOARDING_KEY)) ?? {});
  return parsed.success ? parsed.data : onboardingStateSchema.parse({});
}

export async function saveOnboardingState(state: OnboardingState): Promise<OnboardingState> {
  await putSetting(ONBOARDING_KEY, state);
  return state;
}

// ---------------------------------------------------------------------------
// Step 2: read the company website
// ---------------------------------------------------------------------------

export interface CrawledPage {
  url: string;
  title: string;
  ok: boolean;
  error?: string;
}

/** Same-site links on the homepage that look like About / Products / Services pages. */
async function interestingLinks(homepage: string): Promise<string[]> {
  const res = await fetch(homepage, {
    headers: { 'User-Agent': 'MantisBot/1.0 (+knowledge-base)', Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return [];
  const base = new URL(res.url || homepage);
  const dom = new JSDOM(await res.text(), { url: base.href, virtualConsole: new VirtualConsole() });
  const seen = new Set<string>([base.href.replace(/[#?].*$/, '').replace(/\/$/, '')]);
  const picks: string[] = [];
  const perSection = new Map<string, number>();
  for (const a of dom.window.document.querySelectorAll('a[href]')) {
    let href: URL;
    try {
      href = new URL((a as HTMLAnchorElement).href, base);
    } catch {
      continue;
    }
    if (href.hostname !== base.hostname || !/^https?:$/.test(href.protocol)) continue;
    const clean = href.href.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(clean) || /\.(pdf|jpe?g|png|gif|zip|mp4)$/i.test(clean)) continue;
    seen.add(clean);
    if (!INTERESTING_PAGE.test(href.pathname) && !INTERESTING_PAGE.test(a.textContent ?? '')) continue;
    // At most two pages per top-level section, so About, Products and Services all get a turn.
    const section = href.pathname.split('/').filter(Boolean)[0] ?? '';
    if ((perSection.get(section) ?? 0) >= 2) continue;
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
    picks.push(clean);
    if (picks.length >= MAX_EXTRA_PAGES) break;
  }
  return picks;
}

/** Saves (or refreshes) a scraped page as a WEBSITE knowledge source. */
async function saveWebsiteSource(url: string, title: string, content: string): Promise<string> {
  const existing = await prisma.source.findFirst({ where: { url } });
  const data = { kind: 'WEBSITE' as const, title, content, status: 'OK' as const, error: null, lastCrawledAt: new Date() };
  const s = existing
    ? await prisma.source.update({ where: { id: existing.id }, data })
    : await prisma.source.create({ data: { url, recrawlDays: 30, ...data } });
  await embedKnowledge('SOURCE', s.id).catch(() => 0);
  return s.id;
}

/** Reads the homepage plus a few key pages into the Knowledge Base. */
export async function crawlCompanySite(url: string): Promise<{ pages: CrawledPage[]; text: string }> {
  if (isLinkedIn(url)) throw new Error("LinkedIn pages can't be read automatically. Describe your company in the text box instead.");
  const urls = [url, ...(await interestingLinks(url).catch(() => []))];
  const results = await Promise.all(
    urls.map(async (u): Promise<CrawledPage & { text?: string }> => {
      try {
        const page = await extractReadable(u);
        await saveWebsiteSource(u, page.title, page.text);
        return { url: u, title: page.title, ok: true, text: page.text };
      } catch (err) {
        return { url: u, title: u, ok: false, error: (err as Error).message };
      }
    }),
  );
  const text = results
    .filter((r) => r.ok)
    .map((r) => `## ${r.title} (${r.url})\n${r.text!.slice(0, 6000)}`)
    .join('\n\n');
  return { pages: results.map(({ text: _t, ...p }) => p), text };
}

// ---------------------------------------------------------------------------
// Step 3: company summary
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM =
  'You are a brand strategist setting up a marketing assistant for a company. Use only the information provided. ' +
  'Do not invent facts, numbers, customers or awards. Write in clear, plain English.';

function firstSentences(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).replace(/\s\S*$/, '')}...`;
}

export async function summarizeCompany(input: { companyName: string; description: string; websiteText: string; currentSummary?: string }): Promise<CompanySummary> {
  const material = [
    input.currentSummary && `Current approved summary:\n${input.currentSummary}`,
    input.description && `What the team told us:\n${input.description}`,
    input.websiteText && `Website content:\n${input.websiteText.slice(0, 30_000)}`,
  ].filter(Boolean).join('\n\n');
  const text = await generateText({
    system: SUMMARY_SYSTEM,
    json: true,
    maxTokens: 1200,
    prompt:
      `Company name: ${input.companyName || 'unknown'}\n\n${material}\n\n` +
      'Write JSON with these fields:\n' +
      '- "summary": 2-3 short paragraphs on what the company does, what it offers, who it serves and what makes it different.\n' +
      '- "tagline": the company tagline if one appears, otherwise a short suggested one.\n' +
      '- "mission": one sentence.\n' +
      '- "audience": who the company sells to, one or two sentences.',
    mock: () =>
      JSON.stringify({
        summary: firstSentences(
          input.description ||
            input.websiteText.replace(/^## .*$/gm, '').trim() ||
            input.currentSummary ||
            `${input.companyName} is getting set up in Mantis.`,
        ),
        tagline: '',
        mission: '',
        audience: '',
      }),
  });
  return companySummarySchema.parse(parseJson(text));
}

/** Suggests an updated summary from everything the Knowledge Base has learned since it was approved. */
export async function proposeSummaryRefresh(): Promise<CompanySummary> {
  const brand = await brandProfile();
  const sources = await prisma.source.findMany({
    where: { status: 'OK', kind: { in: ['WEBSITE', 'ARTICLE', 'MANUAL', 'LINKEDIN'] } },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  const products = await prisma.product.findMany({ where: { active: true }, take: 30 });
  const accomplishments = await prisma.accomplishment.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
  const knowledge = [
    ...sources.map((s) => `## ${s.title || s.url}\n${s.content.slice(0, 2500)}`),
    products.length ? `## Products\n${products.map((p) => `- ${p.name}: ${p.description}${p.pricing ? ` (${p.pricing})` : ''}`).join('\n')}` : '',
    accomplishments.length ? `## Accomplishments\n${accomplishments.map((a) => `- ${a.title}: ${a.description}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const next = await summarizeCompany({ companyName: brand.companyName, description: '', websiteText: knowledge, currentSummary: brand.summary });
  return {
    summary: next.summary || brand.summary,
    tagline: next.tagline || brand.tagline,
    mission: next.mission || brand.mission,
    audience: next.audience || brand.audience,
  };
}

// ---------------------------------------------------------------------------
// Step 7: analyze everything and build the brand profile
// ---------------------------------------------------------------------------

const IDLE: AnalyzeProgress = { state: 'idle', done: [], current: null, suggestedProducts: [] };

export async function analysisProgress(): Promise<AnalyzeProgress> {
  return (await getSetting<AnalyzeProgress>(ANALYSIS_KEY)) ?? IDLE;
}

async function report(progress: AnalyzeProgress): Promise<void> {
  await putSetting(ANALYSIS_KEY, progress);
  bus.publish({ userId: '*', type: 'onboarding', payload: progress });
}

export async function startBrandAnalysis(): Promise<AnalyzeProgress> {
  const progress: AnalyzeProgress = { state: 'running', done: [], current: 'website', suggestedProducts: [] };
  await report(progress);
  return progress;
}

interface VoiceGuide {
  voice: string;
  dos: string[];
  donts: string[];
  visualIdentity: string;
}

/** The "Give me a minute..." job: studies the website, sample posts and logos, then writes the voice guide. */
export async function analyzeBrand(): Promise<void> {
  const progress: AnalyzeProgress = { state: 'running', done: [], current: 'website', suggestedProducts: [] };
  const step = async (name: AnalyzeStep, work: () => Promise<void>) => {
    progress.current = name;
    await report(progress);
    await work();
    progress.done.push(name);
  };

  try {
    const brand = await brandProfile();
    let websiteText = '';
    let samples: { platform: string | null; content: string }[] = [];
    const logoNotes: string[] = [];

    await step('website', async () => {
      const pages = await prisma.source.findMany({ where: { kind: 'WEBSITE', status: 'OK', productId: null }, orderBy: { createdAt: 'asc' }, take: 8 });
      websiteText = pages.map((p) => `## ${p.title || p.url}\n${p.content.slice(0, 5000)}`).join('\n\n');
      progress.suggestedProducts = websiteText ? await suggestProducts(websiteText) : [];
    });

    await step('samples', async () => {
      samples = (await prisma.source.findMany({ where: { kind: 'SAMPLE_POST' }, orderBy: { createdAt: 'desc' }, take: 20 })).map((s) => ({
        platform: s.platform,
        content: s.content,
      }));
    });

    await step('logos', async () => {
      const logos = await prisma.brandFile.findMany({ where: { kind: 'LOGO' }, orderBy: { createdAt: 'asc' }, take: 4 });
      for (const logo of logos) {
        try {
          const png = await sharp(await storage.get(logo.storageKey)).resize(512, 512, { fit: 'inside' }).png().toBuffer();
          logoNotes.push((await describeImage(png, `logo ${logo.name}`)).description);
        } catch {
          // An unreadable logo shouldn't stop the analysis.
        }
      }
    });

    await step('voice', async () => {
      const guide = await writeVoiceGuide({ brand, samples, websiteText, logoNotes });
      await prisma.brandProfile.update({
        where: { id: 'brand' },
        data: {
          voice: guide.voice || brand.voice,
          dos: guide.dos.length ? guide.dos : brand.dos,
          donts: guide.donts.length ? guide.donts : brand.donts,
          visualIdentity: guide.visualIdentity || brand.visualIdentity,
        },
      });
      await embedKnowledge('BRAND', 'brand').catch(() => 0);
    });

    progress.current = null;
    progress.state = 'done';
    await report(progress);
  } catch (err) {
    progress.state = 'error';
    progress.error = (err as Error).message;
    await report(progress);
  }
}

async function suggestProducts(websiteText: string): Promise<SuggestedProduct[]> {
  const existing = new Set((await prisma.product.findMany({ select: { name: true } })).map((p) => p.name.toLowerCase()));
  const text = await generateText({
    system: SUMMARY_SYSTEM,
    json: true,
    maxTokens: 1500,
    prompt:
      `Website content:\n${websiteText.slice(0, 30_000)}\n\n` +
      'List the distinct products or services this company sells, up to 12. Respond as JSON: ' +
      '{"products": [{"name": string, "description": string (1-2 sentences), "pricing": string (only if stated, else ""), "url": string (page URL if known, else "")}]}',
    mock: () => JSON.stringify({ products: [] }),
  });
  const parsed = parseJson<{ products?: unknown[] }>(text);
  return (parsed.products ?? [])
    .map((p) => suggestedProductSchema.safeParse(p))
    .filter((r) => r.success)
    .map((r) => r.data!)
    .filter((p) => p.name.trim() && !existing.has(p.name.toLowerCase()))
    .slice(0, 12);
}

async function writeVoiceGuide(input: {
  brand: Awaited<ReturnType<typeof brandProfile>>;
  samples: { platform: string | null; content: string }[];
  websiteText: string;
  logoNotes: string[];
}): Promise<VoiceGuide> {
  const { brand, samples } = input;
  const palette = brand.colors.map((c) => `${c.tier.toLowerCase()} ${c.name || ''} ${c.hex}`.trim());
  const text = await generateText({
    system: SUMMARY_SYSTEM,
    json: true,
    maxTokens: 1800,
    prompt: [
      `Company: ${brand.companyName}`,
      brand.summary && `About the company:\n${brand.summary}`,
      brand.audience && `Audience: ${brand.audience}`,
      brand.voice && `How the team describes their brand voice:\n${brand.voice}`,
      samples.length && `Past social posts written by the team:\n${samples.map((s, i) => `--- Post ${i + 1}${s.platform ? ` (${s.platform})` : ''}\n${s.content.slice(0, 1500)}`).join('\n')}`,
      input.websiteText && `Website excerpts:\n${input.websiteText.slice(0, 8000)}`,
      input.logoNotes.length && `Logos: ${input.logoNotes.join('; ')}`,
      palette.length && `Brand colors: ${palette.join(', ')}`,
      'Build a brand voice guide the marketing writer will follow. Respond as JSON:',
      '{"voice": string (a paragraph describing tone, personality, sentence style, vocabulary, use of emoji/hashtags/exclamation marks, grounded in the team description and the sample posts),',
      ' "dos": string[] (5-8 short rules), "donts": string[] (4-6 short rules),',
      ' "visualIdentity": string (2-3 sentences on the visual style for images and graphics, based on the logos and colors)}',
    ].filter(Boolean).join('\n\n'),
    mock: () =>
      JSON.stringify({
        voice: brand.voice || (samples[0] ? `Write like our past posts, for example: "${firstSentences(samples[0].content, 200)}"` : ''),
        dos: brand.dos,
        donts: brand.donts,
        visualIdentity: brand.visualIdentity || (palette.length ? `Clean layouts using the brand colors (${brand.colors.slice(0, 3).map((c) => c.hex).join(', ')}).` : ''),
      }),
  });
  const g = parseJson<Partial<VoiceGuide>>(text);
  return {
    voice: String(g.voice ?? ''),
    dos: (g.dos ?? []).map(String).filter(Boolean),
    donts: (g.donts ?? []).map(String).filter(Boolean),
    visualIdentity: String(g.visualIdentity ?? ''),
  };
}
