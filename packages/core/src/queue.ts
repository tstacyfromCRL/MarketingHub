import { Queue, Worker, type JobsOptions } from 'bullmq';
import { config } from './config';
import { getDefaultOrgId } from './org';

export interface JobPayloads {
  'publish-post': { postId: string };
  'sweep-due-posts': Record<string, never>;
  'scrape-source': { orgId: string; sourceId: string };
  'recrawl-sources': { orgId: string };
  'embed-knowledge': { orgId: string; sourceType: 'BRAND' | 'PRODUCT' | 'ACCOMPLISHMENT' | 'SOURCE' | 'CLAIM'; sourceId: string };
  'reindex-knowledge': { orgId: string };
  'sync-products': { orgId: string };
  'watch-knowledge': { orgId: string };
  'tag-asset': { assetId: string };
  'rematch-products': { productId?: string };
  'generate-campaign': { campaignId: string };
  'analyze-brand': Record<string, never>;
  'scrape-product-links': { productId: string };
  'send-email': { to: string; subject: string; text: string; html?: string };
  'send-slack': { slackUserId: string; text: string };
}
export type JobName = keyof JobPayloads;
export type JobHandlers = { [K in JobName]: (data: JobPayloads[K]) => Promise<void> };

export interface EnqueueOptions {
  delayMs?: number;
  jobId?: string;
  attempts?: number;
}

const QUEUE_NAME = 'marketing-hub';
const DEFAULT_ATTEMPTS: Partial<Record<JobName, number>> = { 'publish-post': 3, 'send-email': 3, 'send-slack': 3 };

let queue: Queue | null = null;
let inlineHandlers: JobHandlers | null = null;

function connection() {
  const url = new URL(config.REDIS_URL!);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null,
  };
}

export const usingRedis = Boolean(config.REDIS_URL);

export async function enqueue<K extends JobName>(name: K, data: JobPayloads[K], opts: EnqueueOptions = {}): Promise<void> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS[name] ?? 1;
  if (usingRedis) {
    queue ??= new Queue(QUEUE_NAME, { connection: connection() });
    const jobOpts: JobsOptions = {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    };
    await queue.add(name, data, jobOpts);
    return;
  }
  if (!inlineHandlers) throw new Error(`No job handlers registered (job ${name})`);
  const handler = inlineHandlers[name] as (d: JobPayloads[K]) => Promise<void>;
  const run = async (attempt: number) => {
    try {
      await handler(data);
    } catch (err) {
      console.error(`[jobs] ${name} attempt ${attempt} failed:`, err);
      if (attempt < attempts) setTimeout(() => void run(attempt + 1), 30_000 * 2 ** (attempt - 1));
    }
  };
  setTimeout(() => void run(1), opts.delayMs ?? 0);
}

const ORG_JOBS = new Set<JobName>(['recrawl-sources', 'sync-products', 'watch-knowledge']);

/** Repeating jobs run for the one company this server is configured for. */
async function repeatPayload(name: JobName): Promise<JobPayloads[JobName]> {
  if (ORG_JOBS.has(name)) return { orgId: await getDefaultOrgId() } as JobPayloads[JobName];
  return {} as JobPayloads[JobName];
}

/** Dev mode without Redis: run jobs inside the current process. */
export function startInlineJobs(handlers: JobHandlers, repeat: { name: JobName; everyMs: number }[]): void {
  inlineHandlers = handlers;
  for (const r of repeat) {
    setInterval(() => void repeatPayload(r.name).then((data) => enqueue(r.name, data as never)), r.everyMs);
  }
  console.log('[jobs] running background jobs in-process (no REDIS_URL)');
}

export async function startBullWorker(
  handlers: JobHandlers,
  repeat: { name: JobName; everyMs: number }[],
  concurrency = 4,
): Promise<Worker> {
  queue ??= new Queue(QUEUE_NAME, { connection: connection() });
  for (const r of repeat) {
    await queue.upsertJobScheduler(`repeat:${r.name}`, { every: r.everyMs }, { name: r.name, data: await repeatPayload(r.name) });
  }
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name as JobName] as ((d: unknown) => Promise<void>) | undefined;
      if (!handler) throw new Error(`Unknown job ${job.name}`);
      await handler(job.data);
    },
    { connection: connection(), concurrency },
  );
  worker.on('failed', (job, err) => console.error(`[worker] ${job?.name} failed (attempt ${job?.attemptsMade}):`, err.message));
  return worker;
}
