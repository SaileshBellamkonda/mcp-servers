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
const tmpDir = path.join(__dirname, '../../../.tmp-sync-reindex-test');

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

describe('runStartupSync with the docs re-index flag', () => {
  it('force-scans docs once even when rules are unchanged and files are up to date, then clears the flag', async () => {
    writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const globs = { docsInclude: [`${tmpFwd}/**/*.md`], docsExclude: [], codeInclude: [], codeExclude: [] };
    const indexer = new Indexer(db, makeBatchEmbedder(), 500, {
      docsMatcher: new GlobMatcher(globs.docsInclude, [], tmpDir),
    });
    const config = { globs, useGitignore: false };

    // First run: nothing indexed yet, so a normal scan happens.
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    expect(db.isDocsReindexRequired()).toBe(false);

    // Rules are now stored and the file is up to date; flag a re-index.
    db.requireDocsReindex();
    const scanDocs = vi.spyOn(indexer, 'scanDocs');
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);

    expect(scanDocs).toHaveBeenCalledWith(true);
    expect(db.isDocsReindexRequired()).toBe(false);
  });

  it('scans without forcing, and re-indexes nothing, when the flag is not set and nothing changed', async () => {
    writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const globs = { docsInclude: [`${tmpFwd}/**/*.md`], docsExclude: [], codeInclude: [], codeExclude: [] };
    const indexer = new Indexer(db, makeBatchEmbedder(), 500, {
      docsMatcher: new GlobMatcher(globs.docsInclude, [], tmpDir),
    });
    const config = { globs, useGitignore: false };

    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    const scanDocs = vi.spyOn(indexer, 'scanDocs');
    const indexFile = vi.spyOn(indexer, 'indexFile');
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);

    expect(scanDocs).toHaveBeenCalledWith(false);
    expect(indexFile).not.toHaveBeenCalled();
  });
});
