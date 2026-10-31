import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import type { EmbeddingConfig } from '../../../src/core/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-indexer-stale-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

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

describe('indexing a file that no longer produces chunks', () => {
  it('removes the previously indexed rows when the file is reduced to a lone heading', async () => {
    const filePath = path.join(tmpDir, 'page.md');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);

    writeFileSync(filePath, '# Page\n\nuniquewordzebra lives here.');
    await indexer.indexFile(filePath);
    expect(db.listDocuments().has(filePath)).toBe(true);
    expect(db.searchByKeyword('uniquewordzebra', 5, null)).toHaveLength(1);

    writeFileSync(filePath, '# Page\n');
    await indexer.indexFile(filePath);

    expect(db.listDocuments().has(filePath)).toBe(false);
    expect(db.searchByKeyword('uniquewordzebra', 5, null)).toHaveLength(0);
  });

  it('removes the previously indexed rows when the file is reduced to frontmatter only', async () => {
    const filePath = path.join(tmpDir, 'page.md');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);

    writeFileSync(filePath, '# Page\n\nsomething to find');
    await indexer.indexFile(filePath);
    writeFileSync(filePath, '---\ntitle: Only\n---\n');
    await indexer.indexFile(filePath);

    expect(db.listDocuments().has(filePath)).toBe(false);
  });

  it('does not throw for a file that was never indexed', async () => {
    const filePath = path.join(tmpDir, 'empty.md');
    writeFileSync(filePath, '');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    await expect(indexer.indexFile(filePath)).resolves.not.toThrow();
    expect(db.listDocuments().has(filePath)).toBe(false);
  });
});
