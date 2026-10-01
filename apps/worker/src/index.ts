import { jobHandlers, REPEATING_JOBS, startBullWorker, usingRedis } from '@mh/core';
import { ensureDefaults, prisma } from '@mh/db';

if (!usingRedis) {
  console.error('REDIS_URL is not set. Without Redis, the API server runs background jobs itself; the worker is not needed.');
  process.exit(1);
}

await ensureDefaults();
const worker = await startBullWorker(jobHandlers, REPEATING_JOBS);
console.log('[worker] processing jobs');

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
