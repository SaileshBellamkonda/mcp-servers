import type { SqliteDatabase } from './sqlite-db.ts';
import {
  LEGACY_VEC_TABLE,
  VEC_DELETE_TRIGGER_NAME,
  VEC_METRIC_VERSION,
  VEC_TABLE,
  buildVecChunksDdl,
  buildVecDeleteTriggerDdl,
} from './schema.ts';

/**
 * Where the vectors live and how a database written with the old plain vec0 table (`vec_chunks`, searched with a
 * `vec_distance_cosine` scan) is moved to the cosine table (`vec_chunks_cos`, searched with a KNN match).
 *
 * The move copies the stored vectors unchanged, so nothing is re-embedded. It runs in batches, each in its own
 * transaction together with a cursor in `db_meta`, so a crash leaves a consistent half-copy that the next run continues.
 * Until the last step the old table stays the active one and keeps answering searches; the last step (one transaction)
 * copies what arrived meanwhile, drops the old table and the old delete trigger, and writes the version marker.
 */

const META_VERSION = 'vec_metric_version';
const META_CURSOR = 'vec_migrate_cursor';
const DEFAULT_BATCH_SIZE = 200;

export interface VecMigrationOptions {
  /** Vectors copied per transaction (default 200). */
  batchSize?: number | undefined;
  /** Awaited after every batch, so an in-process host stays responsive. */
  yieldToEventLoop?: (() => Promise<void>) | undefined;
  /** Called after every batch with the number of vectors copied by this run so far. */
  onProgress?: ((copied: number) => void) | undefined;
}

function tableExists(db: SqliteDatabase, table: string): boolean {
  return (db.prepare<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.cnt ?? 0) > 0;
}

function getMeta(db: SqliteDatabase, key: string): string | undefined {
  return db.prepare<{ value: string }>('SELECT value FROM db_meta WHERE key = ?').get(key)?.value;
}

function setMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run(key, value);
}

function installDeleteTrigger(db: SqliteDatabase, tables: readonly string[]): void {
  const wanted = buildVecDeleteTriggerDdl(tables);
  const current = db.prepare<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(VEC_DELETE_TRIGGER_NAME)?.sql;
  if (current === wanted) return;
  db.transaction(() => {
    db.exec(`DROP TRIGGER IF EXISTS ${VEC_DELETE_TRIGGER_NAME}`);
    db.exec(wanted);
  })();
}

/** Drops every vector table and creates an empty cosine one: a new embedding dimension invalidates all stored vectors. */
export function resetVecTables(db: SqliteDatabase, dimensions: number): void {
  db.transaction(() => {
    db.exec(`DROP TRIGGER IF EXISTS ${VEC_DELETE_TRIGGER_NAME}`);
    db.exec(`DROP TABLE IF EXISTS ${LEGACY_VEC_TABLE}`);
    db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    db.exec(buildVecChunksDdl(dimensions));
    setMeta(db, META_VERSION, String(VEC_METRIC_VERSION));
    db.prepare('DELETE FROM db_meta WHERE key = ?').run(META_CURSOR);
  })();
}

/**
 * Decides which table is active at open and makes the delete trigger match: the vector row of a deleted chunk goes with
 * it (in both tables while a migration is half done). Returns the active table. A database without any vector table
 * gets an empty cosine one.
 */
export function openVecIndex(db: SqliteDatabase, dimensions: number): string {
  const hasLegacy = tableExists(db, LEGACY_VEC_TABLE);
  const hasCosine = tableExists(db, VEC_TABLE);
  if (!hasLegacy && !hasCosine) db.exec(buildVecChunksDdl(dimensions));
  const migrated = !hasLegacy || (hasCosine && getMeta(db, META_VERSION) === String(VEC_METRIC_VERSION));
  if (migrated) {
    if (getMeta(db, META_VERSION) !== String(VEC_METRIC_VERSION)) setMeta(db, META_VERSION, String(VEC_METRIC_VERSION));
    installDeleteTrigger(db, [VEC_TABLE]);
    return VEC_TABLE;
  }
  installDeleteTrigger(db, hasCosine ? [LEGACY_VEC_TABLE, VEC_TABLE] : [LEGACY_VEC_TABLE]);
  return LEGACY_VEC_TABLE;
}

/**
 * Copies the vectors of the chunks after `cursor` (at most `limit`) from the old table into the new one. Returns the
 * number copied and the id of the last chunk looked at, or null when no chunk follows the cursor.
 */
function copyBatch(db: SqliteDatabase, cursor: number, limit: number): { last: number; copied: number } | null {
  const ids = db.prepare<{ id: number }>('SELECT id FROM chunks WHERE id > ? ORDER BY id LIMIT ?').all(cursor, limit).map((row) => row.id);
  const last = ids.at(-1);
  if (last === undefined) return null;
  const rows = db
    .prepare<{ rowid: number; embedding: Uint8Array }>(`SELECT rowid, embedding FROM ${LEGACY_VEC_TABLE} WHERE rowid IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const insert = db.prepare(`INSERT INTO ${VEC_TABLE} (rowid, embedding) VALUES (?, ?)`);
  for (const row of rows) insert.run(row.rowid, row.embedding);
  return { last, copied: rows.length };
}

/** Moves the vectors to the cosine table. Returns the number copied by this run (0 when there was nothing to do). */
export async function migrateVecIndex(db: SqliteDatabase, dimensions: number, options: VecMigrationOptions = {}): Promise<number> {
  if (!tableExists(db, LEGACY_VEC_TABLE)) return 0;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!tableExists(db, VEC_TABLE)) db.exec(buildVecChunksDdl(dimensions));
  installDeleteTrigger(db, [LEGACY_VEC_TABLE, VEC_TABLE]);

  let cursor = Number(getMeta(db, META_CURSOR) ?? 0);
  let copied = 0;
  for (;;) {
    const batch = db.transaction(() => {
      const result = copyBatch(db, cursor, batchSize);
      if (result) setMeta(db, META_CURSOR, String(result.last));
      return result;
    })();
    if (!batch) break;
    cursor = batch.last;
    copied += batch.copied;
    options.onProgress?.(copied);
    if (options.yieldToEventLoop) await options.yieldToEventLoop();
  }

  // One transaction: what arrived since the last batch, then the switch.
  db.transaction(() => {
    for (let batch = copyBatch(db, cursor, batchSize); batch; batch = copyBatch(db, cursor, batchSize)) {
      cursor = batch.last;
      copied += batch.copied;
    }
    db.exec(`DROP TRIGGER IF EXISTS ${VEC_DELETE_TRIGGER_NAME}`);
    db.exec(`DROP TABLE ${LEGACY_VEC_TABLE}`);
    db.exec(buildVecDeleteTriggerDdl([VEC_TABLE]));
    setMeta(db, META_VERSION, String(VEC_METRIC_VERSION));
    db.prepare('DELETE FROM db_meta WHERE key = ?').run(META_CURSOR);
  })();
  return copied;
}
