import { prisma } from '@mh/db';
import { PLATFORM_PRESETS, planCampaignSlots, type Platform } from '@mh/shared';
import { recordEvent } from './activity';
import { bus } from './bus';
import { saveDesign } from './designs';
import { adaptCopyForPlatforms, composeDesign, generatePostIdeas } from './generation';
import { notify } from './notify';

/** Upper bound so a mistyped quarter with many daily posts can't run up a huge AI bill. */
export const MAX_CAMPAIGN_POSTS = 120;

/**
 * Generates every post in a campaign as a Draft: copy per platform, and a layered graphic
 * per platform size (or one shared graphic when perPlatformFiles is off).
 */
export async function generateCampaign(campaignId: string): Promise<void> {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  try {
    const slots = planCampaignSlots({
      startDate: c.startDate.toISOString().slice(0, 10),
      endDate: c.endDate.toISOString().slice(0, 10),
      postDays: c.postDays,
      postTimes: c.postTimes,
      utcOffsetMinutes: c.utcOffsetMinutes,
    }).slice(0, MAX_CAMPAIGN_POSTS);
    if (slots.length === 0) throw new Error('No posting slots fall within the campaign dates');

    const platforms = c.platforms as Platform[];
    const ideas = await generatePostIdeas({
      brief: c.brief,
      count: slots.length,
      productIds: c.productIds,
      platforms,
      startDate: c.startDate.toISOString().slice(0, 10),
      endDate: c.endDate.toISOString().slice(0, 10),
    });

    const productPhoto = await firstProductPhoto(c.productIds);

    for (let i = 0; i < slots.length; i++) {
      const idea = ideas[i];
      const copy = await adaptCopyForPlatforms(idea.body, platforms);
      const designByPlatform = new Map<string, string>();
      if (c.generateGraphics) {
        const targets = c.perPlatformFiles ? platforms : [platforms[0]];
        let backgroundKey: string | undefined;
        for (const p of targets) {
          const composed = await composeDesign({ headline: idea.headline, subline: idea.subline, platform: p, imagePrompt: idea.imagePrompt, productImageKey: productPhoto, backgroundKey });
          backgroundKey ??= composed.backgroundKey;
          const design = await saveDesign({ name: `${c.name} - ${idea.title} - ${PLATFORM_PRESETS[p].label}`, doc: composed.doc, userId: c.createdById });
          designByPlatform.set(p, design.id);
        }
      }
      const sharedDesign = designByPlatform.get(platforms[0]) ?? null;
      await prisma.post.create({
        data: {
          campaignId: c.id,
          title: idea.title,
          body: idea.body,
          platforms,
          perPlatformFiles: c.perPlatformFiles,
          scheduledAt: slots[i],
          creatorId: c.createdById,
          designId: sharedDesign,
          variants: {
            create: platforms.map((p) => ({ platform: p, body: copy[p] ?? idea.body, designId: designByPlatform.get(p) ?? sharedDesign })),
          },
        },
      });
    }

    await prisma.campaign.update({ where: { id: c.id }, data: { status: 'READY', error: null } });
    const creator = await prisma.user.findUnique({ where: { id: c.createdById } });
    await recordEvent({ actorId: c.createdById, verb: 'generate', entityType: 'campaign', entityId: c.id, summary: `Campaign "${c.name}" generated with ${slots.length} draft posts by ${creator?.name ?? 'a user'}`, link: `/campaigns/${c.id}` });
    await notify([c.createdById], { title: 'Campaign drafts are ready', body: `${slots.length} posts for "${c.name}" are ready for your approval.`, link: `/campaigns/${c.id}` });
  } catch (err) {
    await prisma.campaign.update({ where: { id: c.id }, data: { status: 'FAILED', error: (err as Error).message } });
    await notify([c.createdById], { title: 'Campaign generation failed', body: (err as Error).message, link: `/campaigns/${c.id}` });
  }
  bus.publish({ userId: c.createdById, type: 'campaign', payload: { id: c.id } });
}

/** A confirmed (else suggested) library photo for the first product that has one, uploaded or thumbnail. */
async function firstProductPhoto(productIds: string[]): Promise<string | undefined> {
  if (productIds.length === 0) return undefined;
  const link = await prisma.assetProduct.findFirst({
    where: { productId: { in: productIds }, OR: [{ confirmed: null }, { confirmed: true }], asset: { kind: 'IMAGE', missing: false } },
    orderBy: [{ confirmed: { sort: 'desc', nulls: 'last' } }, { similarity: 'desc' }],
    include: { asset: true },
  });
  return link?.asset.storedKey ?? link?.asset.thumbnailKey ?? undefined;
}
