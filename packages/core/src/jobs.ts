import { rematchProducts, tagAsset } from './assets';
import { generateCampaign } from './campaigns';
import { embedKnowledge, reindexAllKnowledge } from './knowledge';
import { sendEmail, sendSlack } from './notify';
import { duePostIds, publishPost } from './publish';
import { enqueue, type JobHandlers, type JobName } from './queue';
import { dueRecrawlSourceIds, scrapeProductLinks, scrapeSource } from './scrape';
import { analyzeBrand } from './onboarding';

export const jobHandlers: JobHandlers = {
  'publish-post': ({ postId }) => publishPost(postId),
  'sweep-due-posts': async () => {
    for (const id of await duePostIds()) await enqueue('publish-post', { postId: id }, { jobId: `sweep:${id}:${Math.floor(Date.now() / 60_000)}` });
  },
  'scrape-source': ({ sourceId }) => scrapeSource(sourceId),
  'recrawl-sources': async () => {
    for (const id of await dueRecrawlSourceIds()) await enqueue('scrape-source', { sourceId: id });
  },
  'embed-knowledge': async ({ sourceType, sourceId }) => {
    await embedKnowledge(sourceType, sourceId);
  },
  'reindex-knowledge': () => reindexAllKnowledge(),
  'tag-asset': ({ assetId }) => tagAsset(assetId),
  'rematch-products': ({ productId }) => rematchProducts(productId),
  'generate-campaign': ({ campaignId }) => generateCampaign(campaignId),
  'analyze-brand': () => analyzeBrand(),
  'scrape-product-links': ({ productId }) => scrapeProductLinks(productId),
  'send-email': (data) => sendEmail(data),
  'send-slack': (data) => sendSlack(data),
};

export const REPEATING_JOBS: { name: JobName; everyMs: number }[] = [
  { name: 'sweep-due-posts', everyMs: 30_000 },
  { name: 'recrawl-sources', everyMs: 60 * 60_000 },
];
