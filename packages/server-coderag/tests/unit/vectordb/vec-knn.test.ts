import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorDB } from '../../../src/vectordb/db.js';
import { loadSqliteVec, openSqliteDatabase } from '../../../src/vectordb/sqlite-db.js';
import { downgradeToLegacyVectorTable } from '../../helpers/legacy-vec-db.js';
import type { CodeChunk } from '../../../src/core/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_FIXTURE = path.join(here, '../../fixtures/legacy-pre-node-sqlite.db');

let dir: string;
let seed = 4242;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-knn-'));
  seed = 4242;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function gauss(): number {
  return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}
function unitVector(dim: number): number[] {
  const v = Array.from({ length: dim }, gauss);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / Math.sqrt(na * nb);
}

function chunk(name: string, position: number, language = 'typescript'): CodeChunk {
  return { content: `function ${name}() {}`, position, symbolName: name, symbolType: 'function', language, startLine: position, endLine: position, parentSymbol: '', signature: `function ${name}()` };
}

/** One code file with the given vectors; chunks are named `<file>_<i>`. */
function addFile(db: VectorDB, filename: string, vectors: number[][]): void {
  const base = path.basename(filename, '.ts');
  db.insertCodeDocument(filename, new Date(), vectors.map((_v, i) => chunk(`${base}_${String(i)}`, i)), vectors);
}

function names(results: { metadata?: { symbolName: string } | undefined }[]): string[] {
  return results.map((r) => r.metadata?.symbolName ?? '');
}

const rawRows = <T extends object>(file: string, sql: string): T[] => {
  const raw = openSqliteDatabase(file, { allowExtension: true });
  try {
    loadSqliteVec(raw, undefined);
    return raw.prepare<T>(sql).all();
  } finally {
    raw.close();
  }
};
const meta = (file: string, key: string): string | undefined => rawRows<{ value: string }>(file, `SELECT value FROM db_meta WHERE key = '${key}'`)[0]?.value;
const tableNames = (file: string): string[] => rawRows<{ name: string }>(file, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);

describe('a new database', () => {
  it('stores vectors in a cosine vec0 table (chunk_size=256) and records the metric version', () => {
    const file = path.join(dir, 'new.db');
    VectorDB.open(file, 8).close();
    expect(meta(file, 'vec_metric_version')).toBe('2');
    const sql = rawRows<{ sql: string }>(file, "SELECT sql FROM sqlite_master WHERE name = 'vec_chunks_cos'")[0]?.sql ?? '';
    expect(sql).toMatch(/distance_metric\s*=\s*cosine/);
    expect(sql).toMatch(/chunk_size\s*=\s*256/);
    expect(tableNames(file)).not.toContain('vec_chunks');
  });
});

describe('KNN search ranks like the cosine scan', () => {
  const DIM = 24;

  it('returns the same top 10 in the same order as an exact cosine ranking, for unit and non-unit vectors', () => {
    const db = VectorDB.open(':memory:', DIM);
    const vectors: number[][] = [];
    for (let f = 0; f < 6; f++) {
      const fileVectors = Array.from({ length: 60 }, (_v, i) => unitVector(DIM).map((x) => (i % 3 === 0 ? x * (1 + 4 * rnd()) : x)));
      vectors.push(...fileVectors);
      addFile(db, `/p/file${String(f)}.ts`, fileVectors);
    }
    for (let q = 0; q < 25; q++) {
      const query = unitVector(DIM).map((x) => x * (0.5 + rnd()));
      const expected = vectors
        .map((v, i) => ({ name: `file${String(Math.floor(i / 60))}_${String(i % 60)}`, sim: cosineSimilarity(query, v) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 10);
      const got = db.searchWithFilter(query, 10, null);
      expect(names(got)).toEqual(expected.map((e) => e.name));
      for (const [i, r] of got.entries()) expect(r.similarity).toBeCloseTo(1 - (1 - (expected[i]?.sim ?? 0)) / 2, 5);
    }
    db.close();
  });

  it('keeps the meaning of the score: 1 for the same direction, 0.5 for orthogonal, 0 for opposite', () => {
    const db = VectorDB.open(':memory:', 4);
    addFile(db, '/p/a.ts', [[2, 0, 0, 0], [0, 3, 0, 0], [-1, 0, 0, 0]]);
    const hits = db.searchWithFilter([1, 0, 0, 0], 3, null);
    expect(hits.map((h) => h.similarity)).toEqual([expect.closeTo(1, 6), expect.closeTo(0.5, 6), expect.closeTo(0, 6)]);
    db.close();
  });

  it('returns fewer results than asked when the index is small, and none when it is empty', () => {
    const db = VectorDB.open(':memory:', 4);
    expect(db.searchWithFilter([1, 0, 0, 0], 5, null)).toEqual([]);
    addFile(db, '/p/a.ts', [[1, 0, 0, 0], [0, 1, 0, 0]]);
    expect(db.searchWithFilter([1, 0, 0, 0], 5, null)).toHaveLength(2);
    db.close();
  });

  it('skips a stored zero vector (no direction) instead of failing', () => {
    const db = VectorDB.open(':memory:', 4);
    addFile(db, '/p/a.ts', [[0, 0, 0, 0], [1, 0, 0, 0]]);
    expect(names(db.searchWithFilter([1, 0, 0, 0], 5, null))).toEqual(['a_1']);
    db.close();
  });
});

describe('KNN search with filters that exclude most vectors', () => {
  const spies = (db: VectorDB): { knn: ReturnType<typeof vi.spyOn>; scan: ReturnType<typeof vi.spyOn> } => ({
    knn: vi.spyOn(db as unknown as { knnRows(): unknown }, 'knnRows'),
    scan: vi.spyOn(db as unknown as { scanRows(): unknown }, 'scanRows'),
  });

  it('answers a filter that keeps 1% of the index exactly, scanning only the matching chunks', () => {
    const DIM = 8;
    const db = VectorDB.open(':memory:', DIM);
    const query = unitVector(DIM);
    addFile(db, '/big/main.ts', Array.from({ length: 1000 }, () => unitVector(DIM)));
    const away = Array.from({ length: 10 }, () => unitVector(DIM).map((x, i) => x - 2 * (query[i] ?? 0)));
    db.insertCodeDocument('/small/few.ts', new Date(), away.map((_v, i) => chunk(`few_${String(i)}`, i)), away);
    const { knn, scan } = spies(db);
    const hits = db.searchWithFilter(query, 10, { directory: '/small' });
    expect(knn).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(1);
    const expected = away.map((v, i) => ({ i, sim: cosineSimilarity(query, v) })).sort((a, b) => b.sim - a.sim).map((e) => `few_${String(e.i)}`);
    expect(names(hits)).toEqual(expected);
    db.close();
  });

  it('widens the KNN once when a broad filter removes all of the nearest vectors', () => {
    const DIM = 8;
    const db = VectorDB.open(':memory:', DIM);
    const query = unitVector(DIM);
    const near = Array.from({ length: 1000 }, () => unitVector(DIM).map((x, i) => x + 1.5 * (query[i] ?? 0)));
    const far = Array.from({ length: 500 }, () => unitVector(DIM).map((x, i) => x - 1.5 * (query[i] ?? 0)));
    addFile(db, '/near/all.ts', near);
    db.insertCodeDocument('/far/all.ts', new Date(), far.map((_v, i) => chunk(`far_${String(i)}`, i)), far);
    const { knn, scan } = spies(db);
    const hits = db.searchWithFilter(query, 10, { directory: '/far' });
    expect(knn).toHaveBeenCalledTimes(2);
    expect(scan).not.toHaveBeenCalled();
    const expected = far.map((v, i) => ({ i, sim: cosineSimilarity(query, v) })).sort((a, b) => b.sim - a.sim).slice(0, 10).map((e) => `far_${String(e.i)}`);
    expect(names(hits)).toEqual(expected);
    db.close();
  });

  it('is exact even when the matches are beyond the 4,096 nearest vectors (last resort: an exact scan)', () => {
    const DIM = 4;
    const db = VectorDB.open(':memory:', DIM);
    addFile(db, '/near/all.ts', Array.from({ length: 6000 }, () => [1, 0.01 * rnd(), 0.01 * rnd(), 0.01 * rnd()]));
    const far = Array.from({ length: 2000 }, (_v, i) => [-1, i / 2000, 0, 0]);
    db.insertCodeDocument('/far/few.ts', new Date(), far.map((_v, i) => chunk(`far_${String(i)}`, i)), far);
    const { knn, scan } = spies(db);
    const hits = db.searchWithFilter([1, 0, 0, 0], 3, { directory: '/far' });
    expect(knn).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledTimes(1);
    // cosine to [1,0,0,0] is -1/sqrt(1+(i/2000)^2): the larger i, the less opposite
    expect(names(hits)).toEqual(['far_1999', 'far_1998', 'far_1997']);
    db.close();
  });

  it('filters on file pattern, document type and tags like the scan did', () => {
    const DIM = 6;
    const db = VectorDB.open(':memory:', DIM);
    for (let i = 0; i < 300; i++) {
      db.insertDocument(`/docs/note${String(i)}.md`, new Date(), [{ content: `note ${String(i)}`, position: 0 }], [unitVector(DIM)], {
        title: `Note ${String(i)}`, tags: i % 100 === 0 ? ['rare'] : ['common'], docType: i % 100 === 0 ? 'adr' : 'guide', extra: {},
      });
    }
    const query = unitVector(DIM);
    const byType = db.searchWithFilter(query, 10, { docType: 'adr' });
    expect(byType.map((h) => h.document).sort()).toEqual(['/docs/note0.md', '/docs/note100.md', '/docs/note200.md']);
    const byTag = db.searchWithFilter(query, 10, { tags: ['rare'] });
    expect(byTag).toHaveLength(3);
    const byPattern = db.searchWithFilter(query, 10, { filePattern: 'note42.md' });
    expect(byPattern.map((h) => h.document)).toEqual(['/docs/note42.md']);
    db.close();
  });

  it('the hybrid search uses the same semantic leg', () => {
    const db = VectorDB.open(':memory:', 4);
    addFile(db, '/p/a.ts', [[1, 0, 0, 0], [0, 1, 0, 0]]);
    expect(names(db.searchHybrid([0, 1, 0, 0], 'a_0', 2, null))).toEqual(expect.arrayContaining(['a_0', 'a_1']));
    db.close();
  });
});

describe('vector rows follow their chunks', () => {
  it('re-indexing a file and deleting a document leave exactly one vector per chunk', () => {
    const file = path.join(dir, 'consistent.db');
    const db = VectorDB.open(file, 4);
    addFile(db, '/p/a.ts', [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
    addFile(db, '/p/b.ts', [[1, 1, 0, 0]]);
    addFile(db, '/p/a.ts', [[0, 0, 0, 1]]);
    db.insertDocument('/d/x.md', new Date(), [{ content: 'x', position: 0 }, { content: 'y', position: 1 }], [[1, 0, 0, 0], [0, 1, 0, 0]]);
    db.insertDocument('/d/x.md', new Date(), [{ content: 'z', position: 0 }], [[1, 0, 1, 0]]);
    db.deleteDocument('/p/b.ts');
    db.close();
    const chunkIds = rawRows<{ id: number }>(file, 'SELECT id FROM chunks ORDER BY id').map((r) => r.id);
    const vectorIds = rawRows<{ rowid: number }>(file, 'SELECT rowid FROM vec_chunks_cos_rowids ORDER BY rowid').map((r) => r.rowid);
    expect(vectorIds).toEqual(chunkIds);
    expect(chunkIds).toHaveLength(2);
  });
});

// ─── Migration of a database that still has the old vec_chunks table ──────────────────────────────────────────────

function buildLegacy(file: string, dim: number, files: number, perFile: number): number[][] {
  const db = VectorDB.open(file, dim);
  const all: number[][] = [];
  for (let f = 0; f < files; f++) {
    const vectors = Array.from({ length: perFile }, () => unitVector(dim));
    all.push(...vectors);
    addFile(db, `/p/file${String(f)}.ts`, vectors);
  }
  db.close();
  downgradeToLegacyVectorTable(file, dim);
  return all;
}

const vectorsOf = (file: string, table: string): Map<number, string> =>
  new Map(rawRows<{ rowid: number; embedding: Uint8Array }>(file, `SELECT rowid, embedding FROM ${table}`).map((r) => [r.rowid, Buffer.from(r.embedding).toString('hex')]));

describe('upgrading a database written with the old vector table', () => {
  const DIM = 16;

  it('keeps answering searches with the cosine scan until it is migrated', () => {
    const file = path.join(dir, 'legacy.db');
    const vectors = buildLegacy(file, DIM, 3, 40);
    const db = VectorDB.open(file, DIM);
    const query = unitVector(DIM);
    const expected = vectors.map((v, i) => ({ name: `file${String(Math.floor(i / 40))}_${String(i % 40)}`, sim: cosineSimilarity(query, v) })).sort((a, b) => b.sim - a.sim).slice(0, 10);
    expect(names(db.searchWithFilter(query, 10, null))).toEqual(expected.map((e) => e.name));
    expect(meta(file, 'vec_metric_version')).toBeUndefined();
    db.close();
  });

  it('migrates without touching a single stored vector, gives the same results, and drops the old table', async () => {
    const file = path.join(dir, 'legacy.db');
    buildLegacy(file, DIM, 5, 100);
    const before = vectorsOf(file, 'vec_chunks');
    const db = VectorDB.open(file, DIM);
    const queries = Array.from({ length: 8 }, () => unitVector(DIM));
    const resultsBefore = queries.map((q) => db.searchWithFilter(q, 10, null));
    const progress: number[] = [];
    await db.migrateVectorIndex({ batchSize: 64, onProgress: (done) => progress.push(done) });
    const resultsAfter = queries.map((q) => db.searchWithFilter(q, 10, null));
    for (const [i, after] of resultsAfter.entries()) {
      expect(names(after)).toEqual(names(resultsBefore[i] ?? []));
      for (const [j, r] of after.entries()) expect(r.similarity).toBeCloseTo(resultsBefore[i]?.[j]?.similarity ?? -1, 5);
    }
    db.close();

    expect(meta(file, 'vec_metric_version')).toBe('2');
    expect(meta(file, 'vec_migrate_cursor')).toBeUndefined();
    expect(tableNames(file)).not.toContain('vec_chunks');
    expect(vectorsOf(file, 'vec_chunks_cos')).toEqual(before);
    expect(progress.at(-1)).toBe(500);
    expect(rawRows<{ sql: string }>(file, "SELECT sql FROM sqlite_master WHERE name = 'vec_chunks_cos'")[0]?.sql).toMatch(/chunk_size\s*=\s*256/);
  });

  it('yields to the event loop between batches', async () => {
    const file = path.join(dir, 'legacy.db');
    buildLegacy(file, DIM, 2, 100);
    const db = VectorDB.open(file, DIM);
    let yields = 0;
    await db.migrateVectorIndex({ batchSize: 50, yieldToEventLoop: () => { yields++; return Promise.resolve(); } });
    expect(yields).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it('is a no-op for a database that is already migrated, and a second call changes nothing', async () => {
    const file = path.join(dir, 'legacy.db');
    buildLegacy(file, DIM, 1, 30);
    const db = VectorDB.open(file, DIM);
    await db.migrateVectorIndex();
    const first = vectorsOf(file, 'vec_chunks_cos');
    await db.migrateVectorIndex();
    expect(vectorsOf(file, 'vec_chunks_cos')).toEqual(first);
    db.close();
    const fresh = path.join(dir, 'fresh.db');
    const db2 = VectorDB.open(fresh, DIM);
    await db2.migrateVectorIndex();
    db2.close();
    expect(meta(fresh, 'vec_metric_version')).toBe('2');
  });

  it('resumes after a crash in the middle, with edits made in between, and ends consistent', async () => {
    const file = path.join(dir, 'legacy.db');
    buildLegacy(file, DIM, 4, 100);
    let db = VectorDB.open(file, DIM);
    let calls = 0;
    await expect(
      db.migrateVectorIndex({ batchSize: 50, yieldToEventLoop: () => { if (++calls === 3) throw new Error('simulated crash'); return Promise.resolve(); } }),
    ).rejects.toThrow('simulated crash');
    db.close();
    expect(meta(file, 'vec_metric_version')).toBeUndefined();
    expect(Number(meta(file, 'vec_migrate_cursor'))).toBeGreaterThan(0);

    // the process restarts: searches still work on the old table, and the files change before the migration resumes
    db = VectorDB.open(file, DIM);
    expect(db.searchWithFilter(unitVector(DIM), 5, null)).toHaveLength(5);
    db.deleteDocument('/p/file0.ts'); // already copied
    db.deleteDocument('/p/file3.ts'); // not copied yet
    addFile(db, '/p/added.ts', [[...Array.from({ length: DIM - 1 }, () => 0), 1]]);
    await db.migrateVectorIndex({ batchSize: 50 });
    expect(names(db.searchWithFilter([...Array.from({ length: DIM - 1 }, () => 0), 1], 1, null))).toEqual(['added_0']);
    db.close();

    const chunkIds = rawRows<{ id: number }>(file, 'SELECT id FROM chunks ORDER BY id').map((r) => r.id);
    const vectorIds = rawRows<{ rowid: number }>(file, 'SELECT rowid FROM vec_chunks_cos_rowids ORDER BY rowid').map((r) => r.rowid);
    expect(vectorIds).toEqual(chunkIds);
    expect(chunkIds).toHaveLength(201);
    expect(meta(file, 'vec_metric_version')).toBe('2');
  });

  it('a delete keeps working on both tables while the migration is partial', async () => {
    const file = path.join(dir, 'legacy.db');
    buildLegacy(file, DIM, 2, 100);
    const db = VectorDB.open(file, DIM);
    let calls = 0;
    await expect(
      db.migrateVectorIndex({ batchSize: 50, yieldToEventLoop: () => { if (++calls === 2) throw new Error('stop'); return Promise.resolve(); } }),
    ).rejects.toThrow('stop');
    db.deleteDocument('/p/file0.ts');
    addFile(db, '/p/file0.ts', [unitVector(DIM)]);
    db.close();
    const reopened = VectorDB.open(file, DIM);
    await reopened.migrateVectorIndex();
    reopened.close();
    const chunkIds = rawRows<{ id: number }>(file, 'SELECT id FROM chunks ORDER BY id').map((r) => r.id);
    expect(rawRows<{ rowid: number }>(file, 'SELECT rowid FROM vec_chunks_cos_rowids ORDER BY rowid').map((r) => r.rowid)).toEqual(chunkIds);
  });

  it('migrates the database written by the pre-node:sqlite code (default chunk size) and keeps its data', async () => {
    const file = path.join(dir, 'fixture.db');
    copyFileSync(LEGACY_FIXTURE, file);
    const db = VectorDB.open(file, 4);
    const before = db.searchWithFilter([1, 0, 0, 0], 5, null);
    await db.migrateVectorIndex();
    const after = db.searchWithFilter([1, 0, 0, 0], 5, null);
    // the last three are orthogonal to the query and tie at 0.5, so their order is not defined
    const key = (h: { document: string; position: number }): string => `${h.document}#${String(h.position)}`;
    expect(after.slice(0, 2).map(key)).toEqual(before.slice(0, 2).map(key));
    expect(after.slice(2).map(key).sort()).toEqual(before.slice(2).map(key).sort());
    expect(after[0]).toMatchObject({ document: '/docs/install.md', position: 0 });
    expect(after[0]?.similarity).toBeCloseTo(1, 6);
    db.close();
    expect(tableNames(file)).not.toContain('vec_chunks');
  });

  it('recreates the vector table as cosine when the embedding dimension changes', () => {
    const file = path.join(dir, 'resize.db');
    buildLegacy(file, DIM, 1, 5);
    VectorDB.open(file, 8).close();
    expect(meta(file, 'vec_metric_version')).toBe('2');
    expect(tableNames(file)).not.toContain('vec_chunks');
    expect(rawRows<{ sql: string }>(file, "SELECT sql FROM sqlite_master WHERE name = 'vec_chunks_cos'")[0]?.sql).toMatch(/FLOAT\[8\]/i);
  });
});
