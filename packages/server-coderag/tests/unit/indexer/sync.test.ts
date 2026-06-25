import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { syncDocuments } from '../../../src/indexer/sync.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import type { EmbeddingConfig } from '../../../src/core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-sync-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

function makeMockEmbedder(): Embedder {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ index: 0, embedding: Array(DIM).fill(0.1) }] }),
  } as Response);
  return new Embedder(embeddingConfig, mockFetch);
}

function makeBatchEmbedder(): Embedder {
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })),
      }),
    } as Response;
  });
  return new Embedder(embeddingConfig, mockFetch);
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

describe('syncDocuments', () => {
  it('completes without error when documentsDir does not exist', async () => {
    const indexer = new Indexer(db, makeMockEmbedder(), 500);
    await expect(syncDocuments(path.join(tmpDir, 'nonexistent'), db, indexer)).resolves.not.toThrow();
  });

  it('returns zero counts when directory does not exist', async () => {
    const indexer = new Indexer(db, makeMockEmbedder(), 500);
    const result = await syncDocuments(path.join(tmpDir, 'nonexistent'), db, indexer);
    expect(result).toEqual({ indexed: 0, skipped: 0, failed: 0, removed: 0 });
  });

  it('indexes new markdown files found in directory', async () => {
    writeFileSync(path.join(tmpDir, 'hello.md'), '# Hello\n\nWorld content.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    const result = await syncDocuments(tmpDir, db, indexer);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().size).toBeGreaterThan(0);
  });

  it('skips markdown files that have not changed since last index', async () => {
    const mdPath = path.join(tmpDir, 'stable.md');
    writeFileSync(mdPath, '# Stable\n\nUnchanged content.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);

    await syncDocuments(tmpDir, db, indexer);
    const result2 = await syncDocuments(tmpDir, db, indexer);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
    expect(result2.indexed).toBe(0);
  });

  it('removes DB entries for files that no longer exist on disk', async () => {
    const phantomPath = path.join(tmpDir, 'ghost.md');
    db.insertDocument(phantomPath, new Date(), [{ content: 'ghost', position: 0 }], [[0.1, 0.2, 0.3, 0.4]]);
    expect(db.listDocuments().has(phantomPath)).toBe(true);

    const indexer = new Indexer(db, makeMockEmbedder(), 500);
    const result = await syncDocuments(path.join(tmpDir, 'nonexistent'), db, indexer);
    expect(result.removed).toBe(1);
    expect(db.listDocuments().has(phantomPath)).toBe(false);
  });

  it('handles nested subdirectories', async () => {
    const subDir = path.join(tmpDir, 'subdir');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, 'nested.md'), '# Nested\n\nContent here.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    await syncDocuments(tmpDir, db, indexer);
    const docs = db.listDocuments();
    expect([...docs.keys()].some((k) => k.includes('nested.md'))).toBe(true);
  });

  it('skips hidden directories and node_modules', async () => {
    mkdirSync(path.join(tmpDir, '.hidden'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.hidden', 'secret.md'), '# Hidden');
    writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.md'), '# Pkg');
    writeFileSync(path.join(tmpDir, 'visible.md'), '# Visible\n\nContent.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    await syncDocuments(tmpDir, db, indexer);
    const keys = [...db.listDocuments().keys()];
    expect(keys.some((k) => k.includes('visible.md'))).toBe(true);
    expect(keys.some((k) => k.includes('.hidden'))).toBe(false);
    expect(keys.some((k) => k.includes('node_modules'))).toBe(false);
  });
});
