import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { runStartupSync } from '../../../src/indexer/sync.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';
import { SyncManager } from '../../../src/indexer/sync-manager.js';
import type { EmbeddingConfig } from '../../../src/core/types.js';
import type { McpLogger } from '@mcp-servers/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-sync-reindex-failure-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

function makeFailingEmbedder(): Embedder {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: async () => 'embedding service down',
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

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  critical: vi.fn(),
  log: vi.fn(),
} as unknown as McpLogger;

let db: VectorDB;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', DIM);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('docs re-index flag when the forced scan fails', () => {
  it('keeps the flag after a failed forced scan and clears it once a later scan succeeds', async () => {
    writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const globs = { docsInclude: [`${tmpFwd}/**/*.md`], docsExclude: [], codeInclude: [], codeExclude: [] };
    const config = { globs, useGitignore: false };
    const matcher = (): GlobMatcher => new GlobMatcher(globs.docsInclude, [], tmpDir);

    db.requireDocsReindex();

    const failing = new Indexer(db, makeFailingEmbedder(), 500, { docsMatcher: matcher() });
    await runStartupSync(db, failing, new SyncManager(), config, tmpDir, logger);
    expect(db.isDocsReindexRequired()).toBe(true);
    expect(db.getDocumentCountByType('doc')).toBe(0);

    const healthy = new Indexer(db, makeBatchEmbedder(), 500, { docsMatcher: matcher() });
    await runStartupSync(db, healthy, new SyncManager(), config, tmpDir, logger);
    expect(db.isDocsReindexRequired()).toBe(false);
    expect(db.getDocumentCountByType('doc')).toBe(1);
  });
});
