import { config, jobHandlers, REPEATING_JOBS, startInlineJobs, usingRedis } from '@mh/core';
import { ensureDefaults } from '@mh/db';
import { buildApp } from './app';

// The database may still be starting (dev launch, docker-compose), so retry for up to ~60s.
for (let attempt = 1; ; attempt++) {
  try {
    await ensureDefaults();
    break;
  } catch (err) {
    if (attempt >= 30) throw err;
    if (attempt === 1) console.log('[db] waiting for the database...');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!usingRedis) startInlineJobs(jobHandlers, REPEATING_JOBS);

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
