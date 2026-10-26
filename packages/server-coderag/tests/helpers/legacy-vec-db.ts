import { loadSqliteVec, openSqliteDatabase } from '../../src/vectordb/sqlite-db.js';

/**
 * Turns a database made by the current code into one written by the previous version: the vectors move to a plain vec0
 * table `vec_chunks` (default L2 metric, searched by a cosine scan), the cosine table and the metric marker disappear.
 */
export function downgradeToLegacyVectorTable(file: string, dimensions: number): void {
  const raw = openSqliteDatabase(file, { allowExtension: true });
  try {
    loadSqliteVec(raw, undefined);
    const rows = raw.prepare<{ rowid: number; embedding: Uint8Array }>('SELECT rowid, embedding FROM vec_chunks_cos').all();
    raw.exec('DROP TRIGGER IF EXISTS vec_chunks_delete');
    raw.exec('DROP TABLE vec_chunks_cos');
    raw.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding FLOAT[${String(dimensions)}], chunk_size=256)`);
    const insert = raw.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
    for (const row of rows) insert.run(row.rowid, row.embedding);
    raw.exec("DELETE FROM db_meta WHERE key = 'vec_metric_version'");
  } finally {
    raw.close();
  }
}
