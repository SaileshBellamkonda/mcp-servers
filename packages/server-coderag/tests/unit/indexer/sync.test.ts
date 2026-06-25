import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { syncDocuments, runStartupSync } from '../../../src/indexer/sync.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';
import { SyncManager } from '../../../src/indexer/sync-manager.js';
import type { EmbeddingConfig } from '../../../src/core/types.js';
import type { McpLogger } from '../../../src/core/logger.js';

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
    await expect(syncDocuments([path.join(tmpDir, 'nonexistent')], db, indexer)).resolves.not.toThrow();
  });

  it('returns zero counts when directory does not exist', async () => {
    const indexer = new Indexer(db, makeMockEmbedder(), 500);
    const result = await syncDocuments([path.join(tmpDir, 'nonexistent')], db, indexer);
    expect(result).toEqual({ indexed: 0, skipped: 0, failed: 0, removed: 0 });
  });

  it('indexes new markdown files found in directory', async () => {
    writeFileSync(path.join(tmpDir, 'hello.md'), '# Hello\n\nWorld content.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    const result = await syncDocuments([tmpDir], db, indexer);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().size).toBeGreaterThan(0);
  });

  it('skips markdown files that have not changed since last index', async () => {
    const mdPath = path.join(tmpDir, 'stable.md');
    writeFileSync(mdPath, '# Stable\n\nUnchanged content.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);

    await syncDocuments([tmpDir], db, indexer);
    const result2 = await syncDocuments([tmpDir], db, indexer);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
    expect(result2.indexed).toBe(0);
  });

  it('removes DB entries for files that no longer exist on disk', async () => {
    const phantomPath = path.join(tmpDir, 'ghost.md');
    db.insertDocument(phantomPath, new Date(), [{ content: 'ghost', position: 0 }], [[0.1, 0.2, 0.3, 0.4]]);
    expect(db.listDocuments().has(phantomPath)).toBe(true);

    const indexer = new Indexer(db, makeMockEmbedder(), 500);
    const result = await syncDocuments([path.join(tmpDir, 'nonexistent')], db, indexer);
    expect(result.removed).toBe(1);
    expect(db.listDocuments().has(phantomPath)).toBe(false);
  });

  it('handles nested subdirectories', async () => {
    const subDir = path.join(tmpDir, 'subdir');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, 'nested.md'), '# Nested\n\nContent here.');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    await syncDocuments([tmpDir], db, indexer);
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
    await syncDocuments([tmpDir], db, indexer);
    const keys = [...db.listDocuments().keys()];
    expect(keys.some((k) => k.includes('visible.md'))).toBe(true);
    expect(keys.some((k) => k.includes('.hidden'))).toBe(false);
    expect(keys.some((k) => k.includes('node_modules'))).toBe(false);
  });
});

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  critical: vi.fn(),
  log: vi.fn(),
} as unknown as McpLogger;

describe('runStartupSync', () => {
  it('scans docs when none are indexed', async () => {
    writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir),
    });
    const sm = new SyncManager();
    await runStartupSync(
      db, indexer, sm,
      { globs: { docsInclude: ['**/*.md'], docsExclude: [], codeInclude: [], codeExclude: [] }, useGitignore: false },
      tmpDir, mockLogger
    );
    expect(db.getDocumentCountByType('doc')).toBeGreaterThan(0);
  });

  it('scans code when none is indexed', async () => {
    writeFileSync(path.join(tmpDir, 'app.ts'), 'export function app() { return 1; }');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500, {
      codeMatcher: new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir),
    });
    const sm = new SyncManager();
    await runStartupSync(
      db, indexer, sm,
      { globs: { docsInclude: [], docsExclude: [], codeInclude: ['**/*.ts'], codeExclude: [] }, useGitignore: false },
      tmpDir, mockLogger
    );
    expect(db.getDocumentCountByType('code')).toBeGreaterThan(0);
  });

  it('saves current rules to DB after sync', async () => {
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    const sm = new SyncManager();
    const globs = { docsInclude: ['**/*.md'], docsExclude: ['drafts/**'], codeInclude: ['**/*.ts'], codeExclude: [] };
    await runStartupSync(db, indexer, sm, { globs, useGitignore: false }, tmpDir, mockLogger);
    const stored = db.getStoredRules();
    expect(stored?.docsInclude).toEqual(['**/*.md']);
    expect(stored?.docsExclude).toEqual(['drafts/**']);
  });

  it('prunes docs that no longer match the include rules when rules changed', async () => {
    const subDir = path.join(tmpDir, 'legacy');
    mkdirSync(subDir, { recursive: true });
    const oldDocPath = path.join(subDir, 'old.md');
    writeFileSync(oldDocPath, '# Old');
    db.insertDocument(oldDocPath, new Date(), [{ content: 'old', position: 0 }], [[0.1, 0.2, 0.3, 0.4]]);

    // Store old rules that used to include it
    db.saveRules({ docsInclude: ['**/*.md'], docsExclude: [], codeInclude: [], codeExclude: [] });

    // New rules: only files directly in tmpDir (not subdirectories)
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/*.md`], [], tmpDir),
    });
    const sm = new SyncManager();
    const newGlobs = { docsInclude: [`${tmpFwd}/*.md`], docsExclude: [], codeInclude: [], codeExclude: [] };
    await runStartupSync(db, indexer, sm, { globs: newGlobs, useGitignore: false }, tmpDir, mockLogger);

    expect(db.listDocuments().has(oldDocPath)).toBe(false);
  });

  it('removes stale file entries even when rules have not changed', async () => {
    const ghostPath = path.join(tmpDir, 'ghost.md');
    db.insertDocument(ghostPath, new Date(), [{ content: 'gone', position: 0 }], [[0.1, 0.2, 0.3, 0.4]]);
    const rules = { docsInclude: ['**/*.md'], docsExclude: [], codeInclude: [], codeExclude: [] };
    db.saveRules(rules);
    db.insertDocument(ghostPath, new Date(), [{ content: 'still', position: 0 }], [[0.1, 0.2, 0.3, 0.4]]);

    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    const sm = new SyncManager();
    await runStartupSync(db, indexer, sm, { globs: rules, useGitignore: false }, tmpDir, mockLogger);

    // ghostPath does not exist on disk → should be removed
    expect(db.listDocuments().has(ghostPath)).toBe(false);
  });

  it('throws SyncInProgressError when SyncManager is already locked', async () => {
    const indexer = new Indexer(db, makeBatchEmbedder(), 500);
    const sm = new SyncManager();
    let releaseLock!: () => void;
    const first = sm.run('blocker', () => new Promise<void>((r) => { releaseLock = r; }));
    const config = { globs: { docsInclude: [], docsExclude: [], codeInclude: [], codeExclude: [] }, useGitignore: false };
    await expect(runStartupSync(db, indexer, sm, config, tmpDir, mockLogger)).rejects.toThrow();
    releaseLock();
    await first;
  });
});
