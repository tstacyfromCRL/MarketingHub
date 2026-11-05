/**
 * Replace packages/db/.pglite with the newest snapshot from .pglite-backups.
 * Run this when the data folder will not open. Stop the dev database first;
 * the command refuses while port 5432 is accepting connections.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_DIR_NAME, DATA_DIR_NAME, restoreLatest, tcpPortOpen } from './pgliteBackup';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(packageRoot, DATA_DIR_NAME);
const backupDir = path.join(packageRoot, BACKUP_DIR_NAME);
const port = Number(process.env.DEV_DB_PORT ?? 5432);

try {
  const result = await restoreLatest({
    dataDir,
    backupDir,
    portBusy: () => tcpPortOpen('127.0.0.1', port),
  });
  console.log(`Restored ${result.snapshot}`);
  console.log(`Dev database folder: ${dataDir}`);
  if (result.movedAside) console.log(`Kept the previous folder at ${result.movedAside}`);
  console.log('Start the database again with: pnpm dev:db');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
