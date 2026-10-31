import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runStartupSync } from '../../../src/indexer/sync.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import { downgradeToLegacyVectorTable } from '../../helpers/legacy-vec-db.ts';
import type { McpLogger } from '@mcp-servers/common';

const DIM = 4;
let dir: string;
let dbFile: string;
let embeddings = 0;
const logger = {
  debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn(), log: vi.fn(),
} as unknown as McpLogger;

function makeIndexer(db: VectorDB): { indexer: Indexer; config: { globs: { docsInclude: string[]; docsExclude: string[]; codeInclude: string[]; codeExclude: string[] }; useGitignore: boolean } } {
  const fetchFn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { input: string[] };
    embeddings += body.input.length;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: body.input.map((_t, i) => ({ index: i, embedding: [0.1 * (i + 1), 0.2, 0.3, 0.4] })) }) } as Response);
  });
  const glob = `${dir.replace(/\\/g, '/')}/**/*.ts`;
  const globs = { docsInclude: [], docsExclude: [], codeInclude: [glob], codeExclude: [] };
  const indexer = new Indexer(db, new Embedder({ url: 'http://x', model: 't', batchSize: 10 }, fetchFn as unknown as typeof fetch), 500, { codeMatcher: new GlobMatcher([glob], [], dir) });
  return { indexer, config: { globs, useGitignore: false } };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-vecsync-'));
  dbFile = path.join(dir, 'index.db');
  embeddings = 0;
  writeFileSync(path.join(dir, 'a.ts'), 'export function alpha(): number { return 1; }\nexport function beta(): number { return 2; }\n');
  // an index written by the previous version: vectors in the old table
  const db = VectorDB.open(dbFile, DIM);
  const { indexer } = makeIndexer(db);
  return indexer.indexCodeFile(path.join(dir, 'a.ts')).then(() => {
    indexer.close();
    db.close();
    downgradeToLegacyVectorTable(dbFile, DIM);
    embeddings = 0;
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('startup sync and the vector index', () => {
  it('moves an index with the old vector table to the cosine table without embedding anything again', async () => {
    const db = VectorDB.open(dbFile, DIM);
    expect(db.isVectorIndexMigrated()).toBe(false);
    const { indexer, config } = makeIndexer(db);
    // the parser version of the index is current, so the sync itself re-embeds nothing
    db.setCodeParserVersion((await import('../../../src/indexer/code-parser.ts')).CODE_PARSER_VERSION);
    await runStartupSync(db, indexer, new SyncManager(), config, dir, logger);
    expect(db.isVectorIndexMigrated()).toBe(true);
    expect(embeddings).toBe(0);
    expect(db.searchWithFilter([0.1, 0.2, 0.3, 0.4], 5, null).map((h) => h.metadata?.symbolName).sort()).toEqual(['alpha', 'beta']);
    indexer.close();
    db.close();
  });

  it('keeps syncing, on the old vector table, when the migration fails, and tries again at the next start', async () => {
    const db = VectorDB.open(dbFile, DIM);
    const { indexer, config } = makeIndexer(db);
    vi.spyOn(db, 'migrateVectorIndex').mockRejectedValueOnce(new Error('disk full'));
    await runStartupSync(db, indexer, new SyncManager(), config, dir, logger);
    expect(db.isVectorIndexMigrated()).toBe(false);
    expect((logger.warning as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toContain('disk full');
    expect(db.getLastSyncAt('code')).not.toBeNull();
    await runStartupSync(db, indexer, new SyncManager(), config, dir, logger);
    expect(db.isVectorIndexMigrated()).toBe(true);
    indexer.close();
    db.close();
  });
});
