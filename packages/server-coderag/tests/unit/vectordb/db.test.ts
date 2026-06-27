import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { MarkdownChunk, CodeChunk } from '../../../src/core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-db-test');

const DIM = 4;

function makeEmbedding(values: number[]): number[] {
  return values;
}

function makeMarkdownChunks(texts: string[]): MarkdownChunk[] {
  return texts.map((content, i) => ({ content, position: i }));
}

function makeCodeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: 'function foo() {}',
    position: 0,
    symbolName: 'foo',
    symbolType: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    parentSymbol: '',
    signature: 'function foo()',
    ...overrides,
  };
}

let db: VectorDB;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', DIM);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('VectorDB.open', () => {
  it('opens without error', () => {
    expect(db).toBeDefined();
  });

  it('stores dimension in db_meta', () => {
    const stored = db.getStoredDimensions();
    expect(stored).toBe(DIM);
  });
});

describe('VectorDB.readStoredDimensions', () => {
  it('returns null for :memory:', () => {
    expect(VectorDB.readStoredDimensions(':memory:')).toBeNull();
  });

  it('returns null when DB file does not exist', () => {
    expect(VectorDB.readStoredDimensions(path.join(tmpDir, 'nonexistent.db'))).toBeNull();
  });

  it('reads dimensions from an existing DB file without loading sqlite-vec', () => {
    const dbPath = path.join(tmpDir, 'test.db');
    const created = VectorDB.open(dbPath, DIM);
    created.close();
    expect(VectorDB.readStoredDimensions(dbPath)).toBe(DIM);
  });

  it('allows warm-start VectorDB.open using stored dimensions', () => {
    const dbPath = path.join(tmpDir, 'warm.db');
    const first = VectorDB.open(dbPath, DIM);
    first.close();
    const stored = VectorDB.readStoredDimensions(dbPath);
    expect(stored).toBe(DIM);
    const second = VectorDB.open(dbPath, stored!);
    expect(second.getStoredDimensions()).toBe(DIM);
    second.close();
  });
});

describe('insertDocument and listDocuments', () => {
  it('inserts a markdown document and returns it in list', () => {
    const chunks = makeMarkdownChunks(['Hello world']);
    const embeddings = [makeEmbedding([0.1, 0.2, 0.3, 0.4])];
    db.insertDocument('/docs/test.md', new Date('2024-01-01'), chunks, embeddings);
    const docs = db.listDocuments();
    expect(docs.has('/docs/test.md')).toBe(true);
  });

  it('replaces existing document on re-insert', () => {
    const chunks = makeMarkdownChunks(['v1']);
    db.insertDocument('/docs/test.md', new Date('2024-01-01'), chunks, [[0.1, 0.2, 0.3, 0.4]]);
    const chunks2 = makeMarkdownChunks(['v2']);
    db.insertDocument('/docs/test.md', new Date('2024-01-02'), chunks2, [[0.5, 0.6, 0.7, 0.8]]);
    const docs = db.listDocuments();
    expect(docs.size).toBe(1);
  });

  it('throws when chunk and embedding counts differ', () => {
    const chunks = makeMarkdownChunks(['a', 'b']);
    expect(() => db.insertDocument('/docs/mismatch.md', new Date(), chunks, [[0.1, 0.2, 0.3, 0.4]])).toThrow('count mismatch');
  });
});

describe('insertCodeDocument error cases', () => {
  it('throws when chunk and embedding counts differ', () => {
    const chunks = [makeCodeChunk(), makeCodeChunk({ symbolName: 'bar', position: 1 })];
    expect(() => db.insertCodeDocument('/src/mismatch.ts', new Date(), chunks, [[0.1, 0.2, 0.3, 0.4]])).toThrow('count mismatch');
  });
});

describe('deleteDocument', () => {
  it('removes the document and its chunks', () => {
    db.insertDocument('/docs/del.md', new Date(), makeMarkdownChunks(['bye']), [[0.1, 0.2, 0.3, 0.4]]);
    db.deleteDocument('/docs/del.md');
    expect(db.listDocuments().has('/docs/del.md')).toBe(false);
  });

  it('throws when document not found', () => {
    expect(() => db.deleteDocument('/nonexistent.md')).toThrow();
  });
});

describe('insertCodeDocument and searchWithFilter', () => {
  it('inserts code symbols and finds them by vector similarity', () => {
    const chunk = makeCodeChunk({ symbolName: 'createUser' });
    db.insertCodeDocument('/src/user.ts', new Date(), [chunk], [[0.1, 0.2, 0.3, 0.4]]);
    const results = db.searchWithFilter([0.1, 0.2, 0.3, 0.4], 5, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document).toBe('/src/user.ts');
  });

  it('returns code metadata in results', () => {
    const chunk = makeCodeChunk({ symbolName: 'doThing', language: 'typescript' });
    db.insertCodeDocument('/src/thing.ts', new Date(), [chunk], [[0.9, 0.8, 0.1, 0.2]]);
    const results = db.searchWithFilter([0.9, 0.8, 0.1, 0.2], 5, null);
    const withMeta = results.find((r) => r.metadata !== undefined);
    expect(withMeta?.metadata?.symbolName).toBe('doThing');
  });
});

describe('searchWithFilter - filters', () => {
  beforeEach(() => {
    db.insertDocument('/docs/api/auth.md', new Date(), makeMarkdownChunks(['auth doc']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertDocument('/docs/guide.md', new Date(), makeMarkdownChunks(['guide doc']), [[0.5, 0.6, 0.7, 0.8]]);
  });

  it('filters by directory prefix', () => {
    const results = db.searchWithFilter([0.1, 0.2, 0.3, 0.4], 5, { directory: '/docs/api' });
    expect(results.every((r) => r.document.startsWith('/docs/api'))).toBe(true);
  });

  it('filters by file pattern', () => {
    const results = db.searchWithFilter([0.1, 0.2, 0.3, 0.4], 5, { filePattern: 'guide.md' });
    expect(results.every((r) => r.document.endsWith('guide.md'))).toBe(true);
  });
});

describe('searchSymbolsByKeywords', () => {
  beforeEach(() => {
    const chunk = makeCodeChunk({ symbolName: 'handleRequest' });
    db.insertCodeDocument('/src/handler.ts', new Date(), [chunk], [[0.1, 0.2, 0.3, 0.4]]);
  });

  it('returns empty array for empty keywords', () => {
    expect(db.searchSymbolsByKeywords([], 10)).toEqual([]);
  });

  it('finds symbols matching keyword', () => {
    const results = db.searchSymbolsByKeywords(['handle'], 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.metadata?.symbolName).toBe('handleRequest');
  });

  it('returns empty array when no match', () => {
    const results = db.searchSymbolsByKeywords(['zzznomatch'], 10);
    expect(results).toEqual([]);
  });
});

describe('insertRelations and findSymbolRelations', () => {
  let chunkId: number;

  beforeEach(() => {
    const chunk = makeCodeChunk({ symbolName: 'caller' });
    db.insertCodeDocument('/src/caller.ts', new Date(), [chunk], [[0.1, 0.2, 0.3, 0.4]]);
    chunkId = db.getChunkIdBySymbol('/src/caller.ts', 'caller')!;
    db.insertRelations([
      { sourceChunkId: chunkId, targetChunkId: undefined, relationType: 'calls', targetName: 'callee', targetFile: '/src/callee.ts', confidence: 1.0 },
    ]);
  });

  it('finds outgoing relations', () => {
    const results = db.findSymbolRelations('caller', 'outgoing', '');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.targetName).toBe('callee');
  });

  it('finds incoming relations', () => {
    const results = db.findSymbolRelations('callee', 'incoming', '');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.sourceName).toBe('caller');
  });

  it('finds both directions', () => {
    const results = db.findSymbolRelations('caller', 'both', '');
    expect(results.length).toBeGreaterThan(0);
  });

  it('filters by relationType', () => {
    const results = db.findSymbolRelations('caller', 'outgoing', 'calls');
    expect(results.length).toBeGreaterThan(0);
    const none = db.findSymbolRelations('caller', 'outgoing', 'imports');
    expect(none.length).toBe(0);
  });

  it('returns empty array when no relations exist', () => {
    const results = db.findSymbolRelations('foo', 'both', '');
    expect(results).toEqual([]);
  });
});

describe('getChunkIdBySymbol', () => {
  it('returns chunk id when symbol exists', () => {
    const chunk = makeCodeChunk({ symbolName: 'myFunc' });
    db.insertCodeDocument('/src/my.ts', new Date(), [chunk], [[0.1, 0.2, 0.3, 0.4]]);
    const id = db.getChunkIdBySymbol('/src/my.ts', 'myFunc');
    expect(id).toBeGreaterThan(0);
  });

  it('returns null when symbol not found', () => {
    expect(db.getChunkIdBySymbol('/src/my.ts', 'nosuchfn')).toBeNull();
  });
});

describe('getAllDocumentRecords', () => {
  it('returns all document records with timestamps', () => {
    db.insertDocument('/docs/a.md', new Date('2024-01-01'), makeMarkdownChunks(['a']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertDocument('/docs/b.md', new Date('2024-02-01'), makeMarkdownChunks(['b']), [[0.5, 0.6, 0.7, 0.8]]);
    const records = db.getAllDocumentRecords();
    expect(records.length).toBe(2);
    expect(records.some((r) => r.filename === '/docs/a.md')).toBe(true);
  });
});

describe('listDocumentsByType', () => {
  it('returns only doc entries when filtering by "doc"', () => {
    db.insertDocument('/docs/a.md', new Date(), makeMarkdownChunks(['doc']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertCodeDocument('/src/b.ts', new Date(), [makeCodeChunk()], [[0.5, 0.6, 0.7, 0.8]]);
    const docs = db.listDocumentsByType('doc');
    expect(docs.has('/docs/a.md')).toBe(true);
    expect(docs.has('/src/b.ts')).toBe(false);
  });

  it('returns only code entries when filtering by "code"', () => {
    db.insertDocument('/docs/a.md', new Date(), makeMarkdownChunks(['doc']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertCodeDocument('/src/b.ts', new Date(), [makeCodeChunk()], [[0.5, 0.6, 0.7, 0.8]]);
    const code = db.listDocumentsByType('code');
    expect(code.has('/src/b.ts')).toBe(true);
    expect(code.has('/docs/a.md')).toBe(false);
  });

  it('returns empty map when no documents of that type exist', () => {
    db.insertDocument('/docs/a.md', new Date(), makeMarkdownChunks(['doc']), [[0.1, 0.2, 0.3, 0.4]]);
    expect(db.listDocumentsByType('code').size).toBe(0);
  });

  it('includes modification timestamps', () => {
    const modTime = new Date('2024-03-01T00:00:00Z');
    db.insertDocument('/docs/dated.md', modTime, makeMarkdownChunks(['x']), [[0.1, 0.2, 0.3, 0.4]]);
    const docs = db.listDocumentsByType('doc');
    const stored = docs.get('/docs/dated.md');
    expect(stored).toBeDefined();
    expect(stored!.getTime()).toBeCloseTo(modTime.getTime(), -3);
  });
});

describe('getDocumentCountByType', () => {
  it('returns 0 when DB is empty', () => {
    expect(db.getDocumentCountByType('doc')).toBe(0);
    expect(db.getDocumentCountByType('code')).toBe(0);
  });

  it('counts only doc-type entries', () => {
    db.insertDocument('/a.md', new Date(), makeMarkdownChunks(['a']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertDocument('/b.md', new Date(), makeMarkdownChunks(['b']), [[0.5, 0.6, 0.7, 0.8]]);
    db.insertCodeDocument('/c.ts', new Date(), [makeCodeChunk()], [[0.9, 0.1, 0.2, 0.3]]);
    expect(db.getDocumentCountByType('doc')).toBe(2);
    expect(db.getDocumentCountByType('code')).toBe(1);
  });
});

describe('saveRules and getStoredRules', () => {
  it('getStoredRules returns null when no rules have been saved', () => {
    expect(db.getStoredRules()).toBeNull();
  });

  it('round-trips all four glob arrays', () => {
    const globs = {
      docsInclude: ['**/*.md', 'docs/**/*.txt'],
      docsExclude: ['drafts/**'],
      codeInclude: ['**/*.ts', '**/*.py'],
      codeExclude: ['**/*.test.ts', 'dist/**'],
    };
    db.saveRules(globs);
    const stored = db.getStoredRules();
    expect(stored?.docsInclude).toEqual(globs.docsInclude);
    expect(stored?.docsExclude).toEqual(globs.docsExclude);
    expect(stored?.codeInclude).toEqual(globs.codeInclude);
    expect(stored?.codeExclude).toEqual(globs.codeExclude);
  });

  it('overwrites previous rules on second save', () => {
    db.saveRules({ docsInclude: ['**/*.md'], docsExclude: [], codeInclude: [], codeExclude: [] });
    db.saveRules({ docsInclude: ['**/*.txt'], docsExclude: ['drafts/**'], codeInclude: ['**/*.ts'], codeExclude: [] });
    const stored = db.getStoredRules();
    expect(stored?.docsInclude).toEqual(['**/*.txt']);
    expect(stored?.docsExclude).toEqual(['drafts/**']);
  });

  it('returns null after saving only empty arrays', () => {
    db.saveRules({ docsInclude: [], docsExclude: [], codeInclude: [], codeExclude: [] });
    expect(db.getStoredRules()).toBeNull();
  });

  it('preserves pattern order', () => {
    const patterns = ['z/**/*.md', 'a/**/*.md', 'm/**/*.md'];
    db.saveRules({ docsInclude: patterns, docsExclude: [], codeInclude: [], codeExclude: [] });
    expect(db.getStoredRules()?.docsInclude).toEqual(patterns);
  });
});

describe('getLastSyncAt and setLastSyncAt', () => {
  it('returns null before any sync timestamp is stored', () => {
    expect(db.getLastSyncAt('docs')).toBeNull();
    expect(db.getLastSyncAt('code')).toBeNull();
  });

  it('round-trips docs sync timestamp', () => {
    const date = new Date('2024-06-01T10:00:00.000Z');
    db.setLastSyncAt('docs', date);
    expect(db.getLastSyncAt('docs')?.toISOString()).toBe(date.toISOString());
  });

  it('round-trips code sync timestamp', () => {
    const date = new Date('2024-07-15T08:30:00.000Z');
    db.setLastSyncAt('code', date);
    expect(db.getLastSyncAt('code')?.toISOString()).toBe(date.toISOString());
  });

  it('docs and code timestamps are stored independently', () => {
    const d1 = new Date('2024-01-01T00:00:00.000Z');
    const d2 = new Date('2024-06-01T00:00:00.000Z');
    db.setLastSyncAt('docs', d1);
    db.setLastSyncAt('code', d2);
    expect(db.getLastSyncAt('docs')?.toISOString()).toBe(d1.toISOString());
    expect(db.getLastSyncAt('code')?.toISOString()).toBe(d2.toISOString());
  });

  it('updates the timestamp on a second call', () => {
    const d1 = new Date('2024-01-01T00:00:00.000Z');
    const d2 = new Date('2024-12-31T00:00:00.000Z');
    db.setLastSyncAt('docs', d1);
    db.setLastSyncAt('docs', d2);
    expect(db.getLastSyncAt('docs')?.toISOString()).toBe(d2.toISOString());
  });
});

describe('getAllDocumentRecords docType field', () => {
  it('returns docType "doc" for markdown documents', () => {
    db.insertDocument('/docs/a.md', new Date(), makeMarkdownChunks(['a']), [[0.1, 0.2, 0.3, 0.4]]);
    const rec = db.getAllDocumentRecords().find((r) => r.filename === '/docs/a.md');
    expect(rec?.docType).toBe('doc');
  });

  it('returns docType "code" for code documents', () => {
    db.insertCodeDocument('/src/app.ts', new Date(), [makeCodeChunk()], [[0.1, 0.2, 0.3, 0.4]]);
    const rec = db.getAllDocumentRecords().find((r) => r.filename === '/src/app.ts');
    expect(rec?.docType).toBe('code');
  });
});

describe('searchByKeyword (FTS5)', () => {
  beforeEach(() => {
    db.insertDocument('/docs/auth.md', new Date(), makeMarkdownChunks(['Authentication guide for OAuth2']), [[0.1, 0.2, 0.3, 0.4]]);
    db.insertDocument('/docs/guide.md', new Date(), makeMarkdownChunks(['Getting started with the SDK']), [[0.5, 0.6, 0.7, 0.8]]);
    const chunk = makeCodeChunk({ symbolName: 'UserAuthService', content: 'class UserAuthService { login() {} }' });
    db.insertCodeDocument('/src/auth.ts', new Date(), [chunk], [[0.9, 0.1, 0.2, 0.3]]);
  });

  it('returns results matching query term', () => {
    const results = db.searchByKeyword('Authentication', 5, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document).toBe('/docs/auth.md');
  });

  it('finds by symbol_name', () => {
    const results = db.searchByKeyword('UserAuthService', 5, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.document).toBe('/src/auth.ts');
  });

  it('returns empty array when no match', () => {
    const results = db.searchByKeyword('zzznomatchtoken', 5, null);
    expect(results).toEqual([]);
  });

  it('respects topK limit', () => {
    const results = db.searchByKeyword('auth', 1, null);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('filters by directory', () => {
    const results = db.searchByKeyword('auth', 5, { directory: '/docs', filePattern: '' });
    expect(results.every((r) => r.document.startsWith('/docs'))).toBe(true);
  });

  it('similarity scores are positive', () => {
    const results = db.searchByKeyword('Authentication', 5, null);
    expect(results.every((r) => r.similarity > 0)).toBe(true);
  });
});

describe('searchHybrid', () => {
  beforeEach(() => {
    db.insertDocument('/docs/auth.md', new Date(), makeMarkdownChunks(['Authentication guide']), [[0.9, 0.1, 0.1, 0.1]]);
    db.insertDocument('/docs/guide.md', new Date(), makeMarkdownChunks(['Getting started guide']), [[0.1, 0.9, 0.1, 0.1]]);
  });

  it('returns results from both semantic and keyword', () => {
    const results = db.searchHybrid([0.9, 0.1, 0.1, 0.1], 'Authentication', 5, null);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns at most topK results', () => {
    const results = db.searchHybrid([0.9, 0.1, 0.1, 0.1], 'guide', 2, null);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when db is empty and query matches nothing', () => {
    const emptyDb = VectorDB.open(':memory:', DIM);
    const results = emptyDb.searchHybrid([0.1, 0.2, 0.3, 0.4], 'zzz', 5, null);
    expect(results).toEqual([]);
    emptyDb.close();
  });
});

describe('dimension mismatch auto-repair', () => {
  it('resets stored dim and clears sync timestamps when dim changes', () => {
    const dbPath = path.join(tmpDir, 'mismatch.db');
    const db1 = VectorDB.open(dbPath, 4);
    db1.insertDocument('/doc.md', new Date(), makeMarkdownChunks(['hello']), [[0.1, 0.2, 0.3, 0.4]]);
    db1.setLastSyncAt('docs', new Date('2024-01-01T00:00:00.000Z'));
    db1.close();

    const db2 = VectorDB.open(dbPath, 8);
    expect(db2.getStoredDimensions()).toBe(8);
    expect(db2.listDocuments().has('/doc.md')).toBe(true);
    expect(db2.getLastSyncAt('docs')).toBeNull();
    db2.close();
  });
});
