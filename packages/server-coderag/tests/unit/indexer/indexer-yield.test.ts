import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import type { EmbeddingConfig } from '../../../src/core/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-indexer-yield-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

// The mock resolves from microtasks only, so nothing but the indexer itself can hand control back to the event loop.
function makeEmbedder(): Embedder {
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })) }),
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

describe('event-loop yielding while indexing many files', () => {
  it('hands control back to the event loop at least every 5 files', async () => {
    const FILES = 23;
    for (let i = 0; i < FILES; i++) writeFileSync(path.join(tmpDir, `doc${String(i)}.md`), `# Doc ${String(i)}\n\nbody number ${String(i)}`);
    const indexer = new Indexer(db, makeEmbedder(), 500);

    const seen: number[] = [];
    let done = false;
    const ticker = new Promise<void>((resolve) => {
      const tick = (): void => {
        seen.push(db.getDocumentCount());
        if (done) resolve();
        else setImmediate(tick);
      };
      setImmediate(tick);
    });

    const result = await indexer.indexMarkdownDirectory(tmpDir, false);
    done = true;
    await ticker;

    expect(result.indexed).toBe(FILES);
    let previous = 0;
    let largestStep = 0;
    for (const count of seen) {
      largestStep = Math.max(largestStep, count - previous);
      previous = count;
    }
    expect(largestStep).toBeLessThanOrEqual(5);
    expect(seen.length).toBeGreaterThanOrEqual(Math.floor(FILES / 5));
  });

  it('yields while skipping unchanged files too', async () => {
    for (let i = 0; i < 12; i++) writeFileSync(path.join(tmpDir, `doc${String(i)}.md`), `# Doc ${String(i)}\n\nbody ${String(i)}`);
    const indexer = new Indexer(db, makeEmbedder(), 500);
    await indexer.indexMarkdownDirectory(tmpDir, false);

    const spy = vi.spyOn(globalThis, 'setImmediate');
    const result = await indexer.indexMarkdownDirectory(tmpDir, false);
    expect(result.skipped).toBe(12);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
