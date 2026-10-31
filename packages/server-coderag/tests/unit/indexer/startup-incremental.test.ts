import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { runStartupSync } from '../../../src/indexer/sync.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import type { McpLogger } from '@mcp-servers/common';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-startup-incremental-test');
const DIM = 4;

const logger = {
  debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn(), log: vi.fn(),
} as unknown as McpLogger;

let fetchCalls = 0;
function makeEmbedder(): Embedder {
  fetchCalls = 0;
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    fetchCalls++;
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })) }),
    } as Response;
  });
  return new Embedder({ url: 'http://x', model: 'test', batchSize: 100 }, mockFetch);
}

let db: VectorDB;
let indexer: Indexer;
let config: { globs: { docsInclude: string[]; docsExclude: string[]; codeInclude: string[]; codeExclude: string[] }; useGitignore: boolean };
const file = (name: string): string => path.join(tmpDir, name);

function startup(): Promise<void> {
  return runStartupSync(db, indexer, new SyncManager(), config, tmpDir, logger);
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(file('a.ts'), 'export function alpha(): number { return 1; }\n');
  writeFileSync(file('b.ts'), 'export function beta(): number { return 2; }\n');
  writeFileSync(file('guide.md'), '# Guide\n\nSome text about the guide.\n');
  db = VectorDB.open(':memory:', DIM);
  const fwd = tmpDir.replace(/\\/g, '/');
  const globs = { docsInclude: [`${fwd}/**/*.md`], docsExclude: [], codeInclude: [`${fwd}/**/*.ts`], codeExclude: [] };
  indexer = new Indexer(db, makeEmbedder(), 500, {
    docsMatcher: new GlobMatcher(globs.docsInclude, [], tmpDir),
    codeMatcher: new GlobMatcher(globs.codeInclude, [], tmpDir),
  });
  config = { globs, useGitignore: false };
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startup sync with unchanged rules', () => {
  it('scans incrementally and touches neither the parser nor the embedder when nothing changed', async () => {
    await startup();
    expect(db.getDocumentCountByType('code')).toBe(2);

    const indexCode = vi.spyOn(indexer, 'indexCodeFile');
    const indexDoc = vi.spyOn(indexer, 'indexFile');
    const scanCode = vi.spyOn(indexer, 'scanCode');
    const scanDocs = vi.spyOn(indexer, 'scanDocs');
    fetchCalls = 0;
    await startup();

    expect(scanCode).toHaveBeenCalledWith(false);
    expect(scanDocs).toHaveBeenCalledWith(false);
    expect(indexCode).not.toHaveBeenCalled();
    expect(indexDoc).not.toHaveBeenCalled();
    expect(fetchCalls).toBe(0);
  });

  it('re-indexes only the changed and the new files and drops the deleted ones', async () => {
    await startup();

    writeFileSync(file('a.ts'), 'export function alpha(): number { return 100; }\n');
    utimesSync(file('a.ts'), new Date(), new Date(Date.now() + 5000));
    writeFileSync(file('c.ts'), 'export function gamma(): number { return 3; }\n');
    rmSync(file('b.ts'));
    writeFileSync(file('guide.md'), '# Guide\n\nRewritten guide text.\n');
    utimesSync(file('guide.md'), new Date(), new Date(Date.now() + 5000));

    const indexCode = vi.spyOn(indexer, 'indexCodeFile');
    const indexDoc = vi.spyOn(indexer, 'indexFile');
    await startup();

    expect(indexCode.mock.calls.map(([f]) => path.basename(f)).sort()).toEqual(['a.ts', 'c.ts']);
    expect(indexDoc.mock.calls.map(([f]) => path.basename(f))).toEqual(['guide.md']);
    const codeFiles = [...db.listDocumentsByType('code').keys()].map((f) => path.basename(f)).sort();
    expect(codeFiles).toEqual(['a.ts', 'c.ts']);
    expect(db.searchByKeyword('gamma', 5, null)).toHaveLength(1);
    expect(db.searchByKeyword('beta', 5, null)).toHaveLength(0);
  });

  it('notices an edit whose modification time differs only in the milliseconds', async () => {
    const second = Math.floor(Date.now() / 1000) * 1000 - 10_000;
    utimesSync(file('a.ts'), new Date(second + 100), new Date(second + 100));
    await startup();

    writeFileSync(file('a.ts'), 'export function alpha(): number { return 7; }\n');
    utimesSync(file('a.ts'), new Date(second + 600), new Date(second + 600));

    const indexCode = vi.spyOn(indexer, 'indexCodeFile');
    await startup();
    expect(indexCode.mock.calls.map(([f]) => path.basename(f))).toEqual(['a.ts']);
  });

  it('does not re-parse a file without symbols on every startup', async () => {
    writeFileSync(file('types.ts'), '// only a comment\nexport const x = 1;\n');
    await startup();

    const indexCode = vi.spyOn(indexer, 'indexCodeFile');
    await startup();
    expect(indexCode).not.toHaveBeenCalled();
  });

  it('yields to the event loop while scanning many unchanged files', async () => {
    for (let i = 0; i < 23; i++) writeFileSync(file(`f${String(i)}.ts`), `export function f${String(i)}(): number { return ${String(i)}; }\n`);
    await startup();

    const spy = vi.spyOn(globalThis, 'setImmediate');
    await startup();
    // 25 code files: the scan hands control back after every 5th file (at indexes 5, 10, 15 and 20).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
