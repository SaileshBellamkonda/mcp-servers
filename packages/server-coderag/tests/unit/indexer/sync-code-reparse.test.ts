import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { runStartupSync } from '../../../src/indexer/sync.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { CODE_PARSER_VERSION } from '../../../src/indexer/code-parser.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';
import { SyncManager } from '../../../src/indexer/sync-manager.js';
import type { CodeChunk } from '../../../src/core/types.js';
import type { McpLogger } from '@mcp-servers/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-sync-code-reparse-test');

const DIM = 4;

function makeBatchEmbedder(): Embedder {
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })) }),
    } as Response;
  });
  return new Embedder({ url: 'http://x', model: 'test', batchSize: 100 }, mockFetch);
}

const logger = {
  debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn(), log: vi.fn(),
} as unknown as McpLogger;

let db: VectorDB;
let indexer: Indexer;
let config: { globs: { docsInclude: string[]; docsExclude: string[]; codeInclude: string[]; codeExclude: string[] }; useGitignore: boolean };
const sourcePath = (): string => path.join(tmpDir, 'sample.ts');

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(sourcePath(), 'export function greet(name: string): string { return [name].map((n) => n).join(""); }\n');
  db = VectorDB.open(':memory:', DIM);
  const tmpFwd = tmpDir.replace(/\\/g, '/');
  const globs = { docsInclude: [], docsExclude: [], codeInclude: [`${tmpFwd}/**/*.ts`], codeExclude: [] };
  indexer = new Indexer(db, makeBatchEmbedder(), 500, { codeMatcher: new GlobMatcher(globs.codeInclude, [], tmpDir) });
  config = { globs, useGitignore: false };
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function storedSignature(): string | undefined {
  return db.searchByKeyword('greet', 5, null)[0]?.metadata?.signature;
}

describe('code parser version', () => {
  it('is stored by the first startup sync and a later one scans without forcing, so unchanged files are not re-parsed', async () => {
    expect(db.getCodeParserVersion()).toBeNull();
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    expect(db.getCodeParserVersion()).toBe(CODE_PARSER_VERSION);

    const scanCode = vi.spyOn(indexer, 'scanCode');
    const indexCodeFile = vi.spyOn(indexer, 'indexCodeFile');
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    expect(scanCode).toHaveBeenCalledWith(false);
    expect(indexCodeFile).not.toHaveBeenCalled();
  });

  it('re-parses unchanged code files when the stored version is older, refreshing their signatures', async () => {
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    expect(storedSignature()).toBe('function greet(name: string): string');

    // An index written by an older parser: junk signature, version marker missing or lower.
    const stat = db.listDocumentsByType('code').get(sourcePath());
    const chunk: CodeChunk = {
      content: 'function greet() {}', position: 0, symbolName: 'greet', symbolType: 'function', language: 'typescript',
      startLine: 1, endLine: 1, parentSymbol: '', signature: 'function greet(name) { return [name].map((n) =>',
    };
    db.insertCodeDocument(sourcePath(), stat ?? new Date(), [chunk], [[0.1, 0.1, 0.1, 0.1]]);
    db.setCodeParserVersion(CODE_PARSER_VERSION - 1);
    expect(storedSignature()).toBe(chunk.signature);

    const scanCode = vi.spyOn(indexer, 'scanCode');
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);

    expect(scanCode).toHaveBeenCalledWith(true);
    expect(storedSignature()).toBe('function greet(name: string): string');
    expect(db.getCodeParserVersion()).toBe(CODE_PARSER_VERSION);
  });

  it('treats an index from before versioning (no marker) as stale', async () => {
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    db.clearCodeParserVersion();
    utimesSync(sourcePath(), new Date(), new Date());

    const scanCode = vi.spyOn(indexer, 'scanCode');
    await runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
    expect(scanCode).toHaveBeenCalledWith(true);
  });
});
