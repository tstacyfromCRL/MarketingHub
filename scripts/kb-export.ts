import path from 'node:path';
import { exportKnowledgePack, getDefaultOrgId } from '@mh/core';

const dir = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!dir) {
  console.error('Usage: pnpm kb:export <dir>');
  process.exit(1);
}

const orgId = await getDefaultOrgId();
await exportKnowledgePack(orgId, path.resolve(dir));
console.log(`Wrote the knowledge pack to ${path.resolve(dir)}`);
