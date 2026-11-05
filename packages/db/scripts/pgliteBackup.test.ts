/**
 * These tests use a temporary directory only. They must not open or write
 * packages/db/.pglite, which is the live dev database.
 */
import { vector } from '@electric-sql/pglite-pgvector';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  isCheckpointPanic,
  latestSnapshot,
  openFromSnapshot,
  pruneSnapshots,
  restoreLatest,
  writeSnapshot,
} from './pgliteBackup';

describe('isCheckpointPanic', () => {
  it('matches the Postgres message from an interrupted PGlite folder', () => {
    const stderr = [
      'LOG:  database system was interrupted; last known up at 2026-11-05 13:36:39 -05',
      'LOG:  invalid resource manager ID in checkpoint record',
      'PANIC:  could not locate a valid checkpoint record at 0/1C3CA68',
    ].join('\n');
    assert.equal(isCheckpointPanic(stderr), true);
  });

  it('does not treat an ordinary abort as a dead data folder', () => {
    assert.equal(isCheckpointPanic('RuntimeError: Aborted(). Build with -sASSERTIONS for more info.'), false);
  });
});

describe('pruneSnapshots', () => {
  it('keeps the newest snapshots and leaves other files alone', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pglite-prune-'));
    try {
      await writeFile(path.join(dir, 'pglite-20260101-000000-000.tgz'), 'old');
      await writeFile(path.join(dir, 'pglite-20260101-000001-000.tgz'), 'mid');
      await writeFile(path.join(dir, 'pglite-20260101-000002-000.tgz'), 'new');
      await writeFile(path.join(dir, 'notes.txt'), 'leave me');
      await writeFile(path.join(dir, '.pglite-20260101-000003-000.tgz.partial'), 'incomplete');
      await pruneSnapshots(dir, 2);
      const names = (await readdir(dir)).sort();
      assert.deepEqual(names, [
        '.pglite-20260101-000003-000.tgz.partial',
        'notes.txt',
        'pglite-20260101-000001-000.tgz',
        'pglite-20260101-000002-000.tgz',
      ]);
      assert.equal(await latestSnapshot(dir), path.join(dir, 'pglite-20260101-000002-000.tgz'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('snapshot restore', () => {
  it('loads the newest snapshot into a new folder and refuses while the port is busy', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pglite-backup-'));
    const source = path.join(root, 'source');
    const backups = path.join(root, 'backups');
    const restored = path.join(root, 'restored');
    const occupied = path.join(root, 'occupied');
    try {
      const db = await PGlite.create(source, { extensions: { vector } });
      await db.exec("create table backup_marker (note text); insert into backup_marker values ('kept');");
      const snapshot = await writeSnapshot(db, backups, 2);
      await db.close();

      const copy = await openFromSnapshot(snapshot, path.join(root, 'opened'));
      const direct = await copy.query<{ note: string }>('select note from backup_marker');
      assert.equal(direct.rows[0]?.note, 'kept');
      await copy.close();

      await mkdir(occupied);
      await writeFile(path.join(occupied, 'keep.txt'), 'do not move');
      await assert.rejects(
        restoreLatest({ dataDir: occupied, backupDir: backups, portBusy: async () => true }),
        /still running/,
      );
      assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), 'do not move');

      await mkdir(restored);
      await writeFile(path.join(restored, 'broken'), 'old folder');
      const result = await restoreLatest({ dataDir: restored, backupDir: backups, portBusy: async () => false });
      assert.equal(result.snapshot, snapshot);
      assert.equal(existsSync(result.movedAside ?? ''), true);

      const again = await PGlite.create(restored, { extensions: { vector } });
      const rows = await again.query<{ note: string }>('select note from backup_marker');
      assert.equal(rows.rows[0]?.note, 'kept');
      await again.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not move the data folder when there is no snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pglite-empty-backup-'));
    const dataDir = path.join(root, 'data');
    try {
      await mkdir(dataDir);
      await writeFile(path.join(dataDir, 'keep.txt'), 'stay');
      await assert.rejects(
        restoreLatest({ dataDir, backupDir: path.join(root, 'missing'), portBusy: async () => false }),
        /nothing to restore/,
      );
      assert.equal(await readFile(path.join(dataDir, 'keep.txt'), 'utf8'), 'stay');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
