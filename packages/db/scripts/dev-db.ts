/**
 * Local Postgres (with pgvector) for development machines without Docker.
 * Runs PGlite behind a Postgres wire-protocol socket on port 5432.
 * Use DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1&sslmode=disable&pgbouncer=true
 * (pgbouncer=true stops Prisma from using named prepared statements, which would collide
 * because PGlite shares a single session across all socket connections).
 * PGlite has a single database, so there is no shadow DB for `prisma migrate dev`; apply
 * migrations with `pnpm db:deploy` and author new ones with `prisma migrate diff`.
 * Never pass this database as `--shadow-database-url`. Prisma drops the shadow
 * database, which deletes the company.
 * Snapshots go to `.pglite-backups` while this process is running, and once more
 * on Ctrl+C. `pnpm db:restore` loads the newest snapshot when this folder will not open.
 */
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_DIR_NAME,
  DATA_DIR_NAME,
  DEFAULT_BACKUP_INTERVAL_MS,
  openDevDatabase,
  startBackupLoop,
} from './pgliteBackup';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(packageRoot, DATA_DIR_NAME);
const backupDir = path.join(packageRoot, BACKUP_DIR_NAME);
const parsedInterval = Number(process.env.DEV_DB_BACKUP_MS ?? DEFAULT_BACKUP_INTERVAL_MS);
const intervalMs = Number.isFinite(parsedInterval) ? parsedInterval : DEFAULT_BACKUP_INTERVAL_MS;

let db;
try {
  const opened = await openDevDatabase(dataDir, backupDir);
  db = opened.db;
  if (opened.restoredFrom) console.log(`Restored the dev database from ${opened.restoredFrom}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
await db.exec('CREATE EXTENSION IF NOT EXISTS vector;');

const port = Number(process.env.DEV_DB_PORT ?? 5432);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`Dev Postgres (PGlite + pgvector) listening on 127.0.0.1:${port}, data in ${dataDir}`);
if (intervalMs > 0) {
  console.log(`Dev database snapshots every ${Math.round(intervalMs / 1000)}s in ${backupDir}. Restore with: pnpm db:restore`);
}

const backups = startBackupLoop(db, backupDir, intervalMs);
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  backups.stop();
  // Last consistent copy. A hard kill never gets here, which is why the timer exists.
  await backups.snapshotNow();
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
