import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runStartupSync } from '../../../src/indexer/sync.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { CODE_PARSER_VERSION } from '../../../src/indexer/code-parser.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import type { McpLogger } from '@mcp-servers/common';

const DIM = 4;
const SOURCE = [
  '/** Settles outstanding balances between ledgers. */',
  'export function reconcile(a: number): number { return a; }',
  '',
].join('\n');

let dir: string;
let db: VectorDB;
let indexer: Indexer;
let inputs: string[];

const logger = {
  debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn(), log: vi.fn(),
} as unknown as McpLogger;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-docidx-'));
  writeFileSync(path.join(dir, 'a.ts'), SOURCE);
  inputs = [];
  const fetchFn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { input: string[] };
    inputs.push(...body.input);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })) }) } as Response);
  });
  db = VectorDB.open(':memory:', DIM);
  const glob = `${dir.replace(/\\/g, '/')}/**/*.ts`;
  indexer = new Indexer(db, new Embedder({ url: 'http://x', model: 't', batchSize: 10 }, fetchFn as unknown as typeof fetch), 500, { codeMatcher: new GlobMatcher([glob], [], dir) });
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('doc comments while indexing code', () => {
  it('sends the doc comment to the embedder with the code, and stores the code alone', async () => {
    await indexer.indexCodeFile(path.join(dir, 'a.ts'));
    expect(inputs).toEqual(['typescript reconcile: Settles outstanding balances between ledgers.\nfunction reconcile(a: number): number { return a; }']);
    const hit = db.searchByKeyword('ledgers', 5, null)[0];
    expect(hit?.metadata?.symbolName).toBe('reconcile');
    expect(hit?.chunk).not.toContain('ledgers');
  });

  it('an index written by the previous parser version is re-parsed and re-embedded once by the startup sync', async () => {
    await indexer.indexCodeFile(path.join(dir, 'a.ts'));
    db.setCodeParserVersion(CODE_PARSER_VERSION - 1);
    inputs.length = 0;
    const globs = { docsInclude: [], docsExclude: [], codeInclude: [`${dir.replace(/\\/g, '/')}/**/*.ts`], codeExclude: [] };
    await runStartupSync(db, indexer, new SyncManager(), { globs, useGitignore: false }, dir, logger);
    expect(inputs).toHaveLength(1);
    expect(db.getCodeParserVersion()).toBe(CODE_PARSER_VERSION);
    inputs.length = 0;
    await runStartupSync(db, indexer, new SyncManager(), { globs, useGitignore: false }, dir, logger);
    expect(inputs).toHaveLength(0);
  });
});
