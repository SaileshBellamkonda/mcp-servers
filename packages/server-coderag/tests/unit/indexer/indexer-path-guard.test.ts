import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';
import { PathGuard, PathNotAllowedError } from '../../../src/core/path-guard.js';
import type { McpLogger } from '@mcp-servers/common';

const DIM = 4;

function makeEmbedder(): Embedder {
  const mockFetch = vi.fn().mockImplementation((_url: unknown, opts: RequestInit) => {
    const body = JSON.parse(opts.body as string) as { input: string[] };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: body.input.map((_t, i) => ({ index: i, embedding: Array<number>(DIM).fill(0.1) })),
      }),
    } as Response);
  });
  return new Embedder({ url: 'http://x', model: 'test', batchSize: 100 }, mockFetch);
}

let base: string;
let root: string;
let outside: string;
let db: VectorDB;
let symlinksWork = true;

function fakeLogger(): McpLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info: vi.fn(),
    warning: (msg: unknown) => { warnings.push(String(msg)); },
    error: vi.fn(),
  } as unknown as McpLogger & { warnings: string[] };
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-indexer-guard-')));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(root, 'ok.md'), '# Ok\n\nInside the root.');
  writeFileSync(path.join(outside, 'secret.md'), '# Secret\n\nOutside the root.');
  writeFileSync(path.join(outside, 'secret.ts'), 'export function secret(): string { return "s"; }');
  try {
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'), 'file');
    symlinkSync(outside, path.join(root, 'linkdir'), 'junction');
    symlinksWork = true;
  } catch {
    symlinksWork = false;
  }
  db = VectorDB.open(':memory:', DIM);
});

afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

describe('Indexer with a PathGuard', () => {
  it('skips files reached through symlinks that escape the root (indexMarkdownDirectory)', async (ctx) => {
    if (!symlinksWork) ctx.skip();
    const logger = fakeLogger();
    const indexer = new Indexer(db, makeEmbedder(), 500, { pathGuard: new PathGuard([root]), logger });
    const result = await indexer.indexMarkdownDirectory(root, false);

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    const indexed = [...db.listDocuments().keys()];
    expect(indexed).toEqual([path.join(root, 'ok.md')]);
    expect(logger.warnings.some((w) => w.includes('link.md'))).toBe(true);
  });

  it('skips files reached through symlinks that escape the root (scanDocs)', async (ctx) => {
    if (!symlinksWork) ctx.skip();
    const docsMatcher = new GlobMatcher([`${root}/**/*.md`], [], root, false);
    const indexer = new Indexer(db, makeEmbedder(), 500, {
      docsMatcher,
      pathGuard: new PathGuard([root]),
      logger: fakeLogger(),
    });
    const result = await indexer.scanDocs();

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
    expect([...db.listDocuments().keys()]).toEqual([path.join(root, 'ok.md')]);
  });

  it('skips code files that escape the root (scanCode)', async (ctx) => {
    if (!symlinksWork) ctx.skip();
    writeFileSync(path.join(root, 'ok.ts'), 'export function ok(): number { return 1; }');
    const codeMatcher = new GlobMatcher([`${root}/**/*.ts`], [], root, false);
    const indexer = new Indexer(db, makeEmbedder(), 500, {
      codeMatcher,
      pathGuard: new PathGuard([root]),
      logger: fakeLogger(),
    });
    const result = await indexer.scanCode();

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
    expect([...db.listDocuments().keys()]).toEqual([path.join(root, 'ok.ts')]);
  });

  it('indexFile throws PathNotAllowedError for a path outside the roots', async () => {
    const indexer = new Indexer(db, makeEmbedder(), 500, { pathGuard: new PathGuard([root]) });
    await expect(indexer.indexFile(path.join(outside, 'secret.md'))).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(db.listDocuments().size).toBe(0);
  });

  it('indexCodeFile throws PathNotAllowedError for a path outside the roots', async () => {
    const indexer = new Indexer(db, makeEmbedder(), 500, { pathGuard: new PathGuard([root]) });
    await expect(indexer.indexCodeFile(path.join(outside, 'secret.ts'))).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(db.listDocuments().size).toBe(0);
  });

  it('indexFile still indexes a file inside the roots', async () => {
    const indexer = new Indexer(db, makeEmbedder(), 500, { pathGuard: new PathGuard([root]), logger: fakeLogger() });
    await indexer.indexFile(path.join(root, 'ok.md'));
    expect(db.listDocuments().has(path.join(root, 'ok.md'))).toBe(true);
  });

  it('behaves as before when no guard is configured', async () => {
    const indexer = new Indexer(db, makeEmbedder(), 500, { logger: fakeLogger() });
    await indexer.indexFile(path.join(outside, 'secret.md'));
    expect(db.listDocuments().has(path.join(outside, 'secret.md'))).toBe(true);
  });
});
