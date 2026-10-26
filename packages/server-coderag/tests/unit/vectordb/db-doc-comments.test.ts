import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VectorDB } from '../../../src/vectordb/db.js';
import { loadSqliteVec, openSqliteDatabase } from '../../../src/vectordb/sqlite-db.js';
import type { CodeChunk } from '../../../src/core/types.js';

const DIM = 4;
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-docdb-'));
  dbPath = path.join(dir, 'index.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function chunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: 'function reconcile() { return 1; }',
    position: 0,
    symbolName: 'reconcile',
    symbolType: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    parentSymbol: '',
    signature: 'function reconcile()',
    doc: 'Settles outstanding balances between ledgers.',
    ...overrides,
  };
}

describe('doc comments in the keyword index', () => {
  it('finds a function by a word that only its doc comment contains, and shows the code without the doc', () => {
    const db = VectorDB.open(dbPath, DIM);
    db.insertCodeDocument('/src/a.ts', new Date(), [chunk()], [[1, 0, 0, 0]]);
    const hits = db.searchByKeyword('ledgers', 5, null);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.metadata?.symbolName).toBe('reconcile');
    expect(hits[0]?.chunk).toBe('function reconcile() { return 1; }');
    expect(hits[0]?.metadata?.signature).toBe('function reconcile()');
    db.close();
  });

  it('a chunk without a doc is unaffected', () => {
    const db = VectorDB.open(dbPath, DIM);
    const bare = chunk({ doc: undefined });
    db.insertCodeDocument('/src/a.ts', new Date(), [bare], [[1, 0, 0, 0]]);
    expect(db.searchByKeyword('ledgers', 5, null)).toHaveLength(0);
    expect(db.searchByKeyword('reconcile', 5, null)).toHaveLength(1);
    db.close();
  });

  it('keeps the doc words searchable when the keyword index is rebuilt from the stored rows', () => {
    VectorDB.open(dbPath, DIM).close();
    const first = VectorDB.open(dbPath, DIM);
    first.insertCodeDocument('/src/a.ts', new Date(), [chunk()], [[1, 0, 0, 0]]);
    first.close();
    const raw = openSqliteDatabase(dbPath);
    raw.exec("UPDATE db_meta SET value = '1' WHERE key = 'fts_version'");
    raw.close();
    const db = VectorDB.open(dbPath, DIM);
    expect(db.searchByKeyword('ledgers', 5, null)).toHaveLength(1);
    db.close();
  });

  it('adds the doc column to code_metadata of an existing database and leaves old rows without a doc', () => {
    VectorDB.open(dbPath, DIM).close();
    const raw = openSqliteDatabase(dbPath, { allowExtension: true });
    loadSqliteVec(raw, undefined); // the delete trigger on chunks names the vec0 table
    raw.exec('ALTER TABLE code_metadata DROP COLUMN doc');
    raw.close();
    const db = VectorDB.open(dbPath, DIM);
    db.insertCodeDocument('/src/a.ts', new Date(), [chunk()], [[1, 0, 0, 0]]);
    expect(db.searchByKeyword('ledgers', 5, null)).toHaveLength(1);
    db.close();
  });
});
