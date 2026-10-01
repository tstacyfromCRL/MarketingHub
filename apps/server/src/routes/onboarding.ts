import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { onboardingStateSchema, summarizeCompanySchema } from '@mh/shared';
import {
  analysisProgress, brandProfile, crawlCompanySite, enqueue, onboardingState, proposeSummaryRefresh, recordEvent, saveOnboardingState,
  startBrandAnalysis, summarizeCompany, type CrawledPage,
} from '@mh/core';
import { authenticate, badRequest, requireRole } from '../http';

/** The "Create New Company" setup wizard. */
export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/onboarding', async () => ({ state: await onboardingState(), analysis: await analysisProgress() }));

  app.put('/onboarding', { preHandler: requireRole('ADMIN') }, async (req) => {
    const state = await saveOnboardingState(onboardingStateSchema.parse(req.body));
    if (state.completedAt) {
      const brand = await brandProfile();
      await recordEvent({ actorId: req.user.id, verb: 'setup', entityType: 'brand', entityId: 'brand', link: '/knowledge', summary: `${brand.companyName || 'Company'} setup completed by ${req.user.name}` });
    }
    return state;
  });

  /** "Tell me about what your company does, or enter your website's url". Reads the site and drafts a summary. */
  app.post('/onboarding/summarize', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = summarizeCompanySchema.parse(req.body);
    const brand = await brandProfile();
    let pages: CrawledPage[] = [];
    let websiteText = '';
    if (body.url) {
      try {
        ({ pages, text: websiteText } = await crawlCompanySite(body.url));
      } catch (err) {
        if (!body.description.trim()) throw badRequest((err as Error).message);
      }
      await prisma.brandProfile.update({ where: { id: 'brand' }, data: { website: body.url } });
    }
    if (body.description.trim()) {
      await saveManualSource('In your words: what the company does', body.description);
    }
    if (!websiteText && !body.description.trim()) {
      throw badRequest(`I couldn't read ${body.url}. ${pages[0]?.error ?? ''} Try describing your company instead.`.trim());
    }
    const summary = await summarizeCompany({ companyName: brand.companyName, description: body.description, websiteText });
    return { summary, pages };
  });

  /** Starts "Give me a minute to analyze everything..." */
  app.post('/onboarding/analyze', { preHandler: requireRole('ADMIN') }, async (req) => {
    const { voiceNotes } = z.object({ voiceNotes: z.string().default('') }).parse(req.body ?? {});
    if (voiceNotes.trim()) await saveManualSource('In your words: our brand voice', voiceNotes);
    const progress = await startBrandAnalysis();
    await enqueue('analyze-brand', {});
    return progress;
  });

  /** Proposes an updated company summary from everything learned since; the user approves it on the Knowledge page. */
  app.post('/brand/summary/refresh', { preHandler: requireRole('MANAGER') }, async () => proposeSummaryRefresh());
}

/** Keeps the user's own descriptions in the Knowledge Base as editable text sources (one per title). */
export async function saveManualSource(title: string, content: string): Promise<void> {
  const existing = await prisma.source.findFirst({ where: { kind: 'MANUAL', title } });
  const s = existing
    ? await prisma.source.update({ where: { id: existing.id }, data: { content, status: 'PENDING' } })
    : await prisma.source.create({ data: { kind: 'MANUAL', title, content } });
  await enqueue('scrape-source', { sourceId: s.id });
}
