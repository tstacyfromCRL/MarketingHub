import { rematchProducts, tagAsset } from './assets';
import { generateCampaign } from './campaigns';
import { syncProducts } from './connectors/sync';
import { embedKnowledge, reindexAllKnowledge } from './knowledge';
import { watchKnowledgeDir } from './watchKnowledge';
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
  'recrawl-sources': async ({ orgId }) => {
    for (const id of await dueRecrawlSourceIds(orgId)) await enqueue('scrape-source', { orgId, sourceId: id });
  },
  'embed-knowledge': async ({ sourceType, sourceId }) => {
    await embedKnowledge(sourceType, sourceId);
  },
  'reindex-knowledge': ({ orgId }) => reindexAllKnowledge(orgId),
  'sync-products': async ({ orgId }) => {
    await syncProducts(orgId);
  },
  'watch-knowledge': ({ orgId }) => watchKnowledgeDir(orgId),
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
  { name: 'sync-products', everyMs: 24 * 60 * 60_000 },
  { name: 'watch-knowledge', everyMs: 10 * 60_000 },
];
