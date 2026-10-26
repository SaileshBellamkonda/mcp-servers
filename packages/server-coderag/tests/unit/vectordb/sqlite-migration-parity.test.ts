import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorDB } from '../../../src/vectordb/db.js';
import { openSqliteDatabase } from '../../../src/vectordb/sqlite-db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Created by the pre-node:sqlite (native-addon driver) code path: dim 4, default vec0 chunk size, WAL, 2 docs + 1 code file.
const LEGACY_FIXTURE = path.join(here, '../../fixtures/legacy-pre-node-sqlite.db');
const DIM = 4;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-parity-'));
  dbPath = path.join(dir, 'legacy.db');
  copyFileSync(LEGACY_FIXTURE, dbPath);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function vecTableSql(file: string): string {
  const raw = openSqliteDatabase(file, { readonly: true });
  try {
    return raw.prepare<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'vec_chunks'").get()?.sql ?? '';
  } finally {
    raw.close();
  }
}

describe('a database written by the pre-node:sqlite code path', () => {
  it('reads back documents, rules, sync times and the stored dimension', () => {
    const db = VectorDB.open(dbPath, DIM);
    expect(db.getStoredDimensions()).toBe(DIM);
    expect(db.getDocumentCount()).toBe(3);
    expect(db.getDocumentCountByType('code')).toBe(1);
    expect([...db.listDocumentsByType('doc').keys()].sort()).toEqual(['/docs/install.md', '/docs/other.md']);
    expect(db.listDocuments().get('/docs/install.md')?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
    expect(db.getStoredRules()).toEqual({
      docsInclude: ['**/*.md'],
      docsExclude: ['node_modules/**'],
      codeInclude: ['**/*.ts'],
      codeExclude: [],
    });
    expect(db.getLastSyncAt('docs')?.toISOString()).toBe('2025-04-05T00:00:00.000Z');
    expect(db.isDocsReindexRequired()).toBe(false);
    db.close();
  });

  it('returns the same vector KNN ordering and similarities', () => {
    const db = VectorDB.open(dbPath, DIM);
    const hits = db.searchWithFilter([1, 0, 0, 0], 10, null);
    expect(hits.map((h) => [h.document, h.position])).toEqual(
      expect.arrayContaining([['/docs/install.md', 0], ['/docs/install.md', 1], ['/docs/other.md', 0], ['/src/math.ts', 0], ['/src/math.ts', 1]]),
    );
    expect(hits).toHaveLength(5);
    expect(hits[0]).toMatchObject({ document: '/docs/install.md', position: 0, similarity: 1 });
    expect(hits[1]).toMatchObject({ document: '/docs/install.md', position: 1 });
    expect(hits[1]?.similarity).toBeCloseTo(0.9969418745022267, 12);
    expect(hits[0]?.docMetadata).toEqual({ title: 'Deployment Handbook', tags: ['ops', 'setup'], docType: 'guide', domain: 'platform', project: 'coderag' });
    expect(hits[0]?.headingPath).toEqual(['Guide', 'Installation']);
    const code = db.searchWithFilter([0, 1, 0, 0], 2, null);
    expect(code.map((h) => h.metadata?.symbolName)).toEqual(['add', 'sub']);
    db.close();
  });

  it('returns the same FTS5 keyword ordering and scores', () => {
    const db = VectorDB.open(dbPath, DIM);
    const hits = db.searchByKeyword('pnpm', 10, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ document: '/docs/install.md', position: 0 });
    expect(hits[0]?.similarity).toBeCloseTo(0.4852310943070578, 12);
    // title and heading words are indexed too
    expect(db.searchByKeyword('Deployment', 5, null).map((h) => h.document)).toEqual(['/docs/install.md', '/docs/install.md']);
    expect(db.searchSymbolsByKeywords(['add'], 5)[0]?.metadata?.symbolName).toBe('add');
    db.close();
  });

  it('keeps relations readable', () => {
    const db = VectorDB.open(dbPath, DIM);
    const rels = db.findSymbolRelations('sub', 'incoming', '');
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ relationType: 'calls', targetName: 'sub', sourceName: 'add', sourceFile: '/src/math.ts', confidence: 0.9 });
    db.close();
  });

  it('accepts new writes, replaces and deletes, and survives a reopen', () => {
    const db = VectorDB.open(dbPath, DIM);
    db.insertDocument('/docs/new.md', new Date(), [{ content: 'Brand new zebra content', position: 0 }], [[0, 0, 0, 1]]);
    db.insertDocument('/docs/install.md', new Date(), [{ content: 'Replaced body', position: 0 }], [[0.5, 0.5, 0, 0]], { title: 'T', tags: [], extra: {} });
    db.deleteDocument('/docs/other.md');
    expect(db.getDocumentCount()).toBe(3);
    expect(db.searchByKeyword('zebra', 5, null)[0]?.document).toBe('/docs/new.md');
    expect(db.searchWithFilter([0, 0, 0, 1], 1, null)[0]?.document).toBe('/docs/new.md');
    expect(db.searchByKeyword('pnpm', 5, null)).toEqual([]);
    db.close();

    const again = VectorDB.open(dbPath, DIM);
    expect(again.getDocumentCount()).toBe(3);
    expect(again.searchByKeyword('zebra', 5, null)).toHaveLength(1);
    again.close();
  });

  it('keeps its existing vec0 chunk size (no migration) when reopened', () => {
    const before = vecTableSql(dbPath);
    expect(before).not.toMatch(/chunk_size/i);
    VectorDB.open(dbPath, DIM).close();
    expect(vecTableSql(dbPath)).toBe(before);
  });
});

describe('new databases', () => {
  it('create vec_chunks with chunk_size=256', () => {
    const file = path.join(dir, 'fresh.db');
    VectorDB.open(file, DIM).close();
    expect(vecTableSql(file)).toMatch(/chunk_size\s*=\s*256/);
  });

  it('keep chunk_size=256 when the embedding dimension changes and the table is recreated', () => {
    const file = path.join(dir, 'resize.db');
    VectorDB.open(file, DIM).close();
    VectorDB.open(file, 8).close();
    expect(vecTableSql(file)).toMatch(/FLOAT\[8\].*chunk_size\s*=\s*256|chunk_size\s*=\s*256.*FLOAT\[8\]/is);
  });
});
