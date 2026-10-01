/**
 * Local Postgres (with pgvector) for development machines without Docker.
 * Runs PGlite behind a Postgres wire-protocol socket on port 5432.
 * Use DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1&sslmode=disable&pgbouncer=true
 * (pgbouncer=true stops Prisma from using named prepared statements, which would collide
 * because PGlite shares a single session across all socket connections).
 * PGlite has a single database, so there is no shadow DB for `prisma migrate dev`; apply
 * migrations with `pnpm db:deploy` and author new ones with `prisma migrate diff`.
 */
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.pglite');
const db = await PGlite.create(dataDir, { extensions: { vector } });
await db.exec('CREATE EXTENSION IF NOT EXISTS vector;');

const port = Number(process.env.DEV_DB_PORT ?? 5432);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`Dev Postgres (PGlite + pgvector) listening on 127.0.0.1:${port}, data in ${dataDir}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
