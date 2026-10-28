import path from 'node:path';
import { getDefaultOrgId, importKnowledgePack, PackValidationError, recordEvent } from '@mh/core';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
const dir = args.find((arg) => !arg.startsWith('--'));
if (!dir) {
  console.error('Usage: pnpm kb:import <dir> [--dry-run] [--prune]');
  process.exit(1);
}

const orgId = await getDefaultOrgId();
try {
  const report = await importKnowledgePack(orgId, path.resolve(dir), { dryRun, prune });
  if (!dryRun) {
    await recordEvent({ actorId: null, verb: 'import', entityType: 'knowledge-pack', entityId: orgId, summary: `Knowledge pack imported from ${dir}`, link: '/knowledge/pack', meta: report });
  }
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  if (err instanceof PackValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
