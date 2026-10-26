import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Indexer } from '../../../src/indexer/indexer.js';
import { SyncManager } from '../../../src/indexer/sync-manager.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { createCodeRagServer } from '../../../src/server/coderag-server.js';
import { PathGuard, PathNotAllowedError } from '../../../src/core/path-guard.js';

type Handler = (input: unknown) => unknown;
type ToolResult = { content: { text: string }[] };

const DIM = 4;
const SECRET_MD = '# Secret\n\nOutside content.\n';
const SECRET_TS = 'export function secret(): string { return "s"; }\n';

let allowed: string;
let outside: string;
let db: VectorDB;
let handlers: Map<string, Handler>;

function makeEmbedder(): Embedder {
  return {
    embed: vi.fn().mockResolvedValue(Array<number>(DIM).fill(0.1)),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => Array<number>(DIM).fill(0.1)))),
  } as unknown as Embedder;
}

function fakeServer(): McpServer {
  handlers = new Map();
  return {
    registerTool: (name: string, _config: unknown, handler: Handler): void => { handlers.set(name, handler); },
    sendLoggingMessage: () => Promise.resolve(),
  } as unknown as McpServer;
}

async function call(tool: string, input: unknown): Promise<unknown> {
  const handler = handlers.get(tool);
  if (!handler) throw new Error(`tool ${tool} not registered`);
  return await Promise.resolve().then(() => handler(input));
}

async function callJson(tool: string, input: unknown): Promise<Record<string, unknown>> {
  const res = (await call(tool, input)) as ToolResult;
  return JSON.parse(res.content[0]?.text ?? '{}') as Record<string, unknown>;
}

interface ItemResult { success: boolean; error?: string }

beforeEach(() => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-confine-')));
  allowed = path.join(base, 'allowed');
  outside = path.join(base, 'outside');
  mkdirSync(allowed);
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.md'), SECRET_MD);
  writeFileSync(path.join(outside, 'secret.ts'), SECRET_TS);
  writeFileSync(path.join(allowed, 'ok.md'), '# Ok\n\nInside content.\n');
  writeFileSync(path.join(allowed, 'ok.ts'), 'export function ok(): number { return 1; }\n');

  db = VectorDB.open(':memory:', DIM);
  const embedder = makeEmbedder();
  const guard = new PathGuard([allowed]);
  const indexer = new Indexer(db, embedder, 500, { pathGuard: guard, logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } as never });
  createCodeRagServer(fakeServer(), db, embedder, indexer, 5, [allowed], new SyncManager(), undefined, undefined, undefined, guard, { toolset: 'all' });
});

afterEach(() => {
  db.close();
  rmSync(path.dirname(allowed), { recursive: true, force: true });
});

describe('path confinement: index tools report a per-item error', () => {
  const cases: { tool: string; label: string; outsideInput: () => unknown; insideInput: () => unknown }[] = [
    { tool: 'index_markdown', label: 'filepath', outsideInput: () => ({ filepath: path.join(outside, 'secret.md') }), insideInput: () => ({ filepath: path.join(allowed, 'ok.md') }) },
    { tool: 'index_markdown', label: 'filepaths', outsideInput: () => ({ filepaths: `${path.join(allowed, 'ok.md')},${path.join(outside, 'secret.md')}` }), insideInput: () => ({ filepaths: path.join(allowed, 'ok.md') }) },
    { tool: 'index_markdown', label: 'directory', outsideInput: () => ({ directory: outside }), insideInput: () => ({ directory: allowed }) },
    { tool: 'index_markdown', label: 'directories', outsideInput: () => ({ directories: outside }), insideInput: () => ({ directories: allowed }) },
    { tool: 'index_code', label: 'filepath', outsideInput: () => ({ filepath: path.join(outside, 'secret.ts') }), insideInput: () => ({ filepath: path.join(allowed, 'ok.ts') }) },
    { tool: 'index_code', label: 'filepaths', outsideInput: () => ({ filepaths: path.join(outside, 'secret.ts') }), insideInput: () => ({ filepaths: path.join(allowed, 'ok.ts') }) },
    { tool: 'index_code', label: 'directory', outsideInput: () => ({ directory: outside }), insideInput: () => ({ directory: allowed }) },
    { tool: 'index_code', label: 'directories', outsideInput: () => ({ directories: outside }), insideInput: () => ({ directories: allowed }) },
  ];

  for (const c of cases) {
    it(`${c.tool} rejects an outside ${c.label} and indexes nothing outside`, async () => {
      const out = (await callJson(c.tool, c.outsideInput())) as { results: ItemResult[] };
      const failures = out.results.filter((r) => !r.success);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0]?.error).toContain('CODERAG_ALLOWED_ROOTS');
      for (const name of db.listDocuments().keys()) {
        expect(name.startsWith(outside)).toBe(false);
      }
    });

    it(`${c.tool} still works for an inside ${c.label}`, async () => {
      const out = (await callJson(c.tool, c.insideInput())) as { results: ItemResult[] };
      expect(out.results.every((r) => r.success)).toBe(true);
      expect(db.listDocuments().size).toBeGreaterThan(0);
    });
  }
});

describe('path confinement: reindex_document, delete_document, sync_documents', () => {
  function seed(file: string): void {
    db.insertDocument(file, new Date(), [{ content: 'seeded', position: 0 }], [Array<number>(DIM).fill(0.1)], { title: 't', tags: [], extra: {} });
  }

  it('reindex_document rejects an outside file and leaves the index untouched', async () => {
    const file = path.join(outside, 'secret.md');
    seed(file);
    await expect(call('reindex_document', { filename: file })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(db.listDocuments().has(file)).toBe(true);
    await expect(call('reindex_document', { filename: path.join(outside, 'secret.ts') })).rejects.toBeInstanceOf(PathNotAllowedError);
  });

  it('reindex_document still works inside the root', async () => {
    const out = await callJson('reindex_document', { filename: path.join(allowed, 'ok.md') });
    expect(out['success']).toBe(true);
    expect(db.listDocuments().has(path.join(allowed, 'ok.md'))).toBe(true);
  });

  it('delete_document rejects an outside file and keeps its index entry', async () => {
    const file = path.join(outside, 'secret.md');
    seed(file);
    await expect(call('delete_document', { filename: file })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(db.listDocuments().has(file)).toBe(true);
  });

  it('delete_document still works inside the root', async () => {
    const file = path.join(allowed, 'ok.md');
    seed(file);
    const out = await callJson('delete_document', { filename: file });
    expect(out['success']).toBe(true);
    expect(db.listDocuments().has(file)).toBe(false);
  });

  it('sync_documents rejects an outside directory and indexes nothing', async () => {
    await expect(call('sync_documents', { directory: outside })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(db.listDocuments().size).toBe(0);
  });

  it('sync_documents works for an inside directory and for the configured default', async () => {
    expect((await callJson('sync_documents', { directory: allowed }))['success']).toBe(true);
    expect(db.listDocuments().has(path.join(allowed, 'ok.md'))).toBe(true);
    expect((await callJson('sync_documents', {}))['success']).toBe(true);
  });
});

describe('path confinement: frontmatter tools', () => {
  it('add_frontmatter rejects an outside file and leaves it unchanged', async () => {
    const file = path.join(outside, 'secret.md');
    await expect(call('add_frontmatter', { filepath: file, domain: 'backend' })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(readFileSync(file, 'utf8')).toBe(SECRET_MD);
  });

  it('add_frontmatter still works inside the root', async () => {
    const file = path.join(allowed, 'ok.md');
    const out = await callJson('add_frontmatter', { filepath: file, domain: 'backend' });
    expect(out['success']).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('domain: backend');
  });

  it('update_frontmatter rejects an outside file and leaves it unchanged', async () => {
    const file = path.join(outside, 'secret.md');
    await expect(call('update_frontmatter', { filepath: file, domain: 'backend' })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(readFileSync(file, 'utf8')).toBe(SECRET_MD);
  });

  it('update_frontmatter still works inside the root', async () => {
    const file = path.join(allowed, 'ok.md');
    const out = await callJson('update_frontmatter', { filepath: file, domain: 'backend' });
    expect(out['success']).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('domain: backend');
  });

  it('both tools reject ".." traversal out of the root', async () => {
    const sneaky = path.join(allowed, '..', 'outside', 'secret.md');
    await expect(call('add_frontmatter', { filepath: sneaky, domain: 'x' })).rejects.toBeInstanceOf(PathNotAllowedError);
    await expect(call('update_frontmatter', { filepath: sneaky, domain: 'x' })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe(SECRET_MD);
  });
});

describe('path confinement: default guard', () => {
  it('createCodeRagServer defaults to a guard rooted at the working directory', async () => {
    const embedder = makeEmbedder();
    const indexer = new Indexer(db, embedder, 500);
    createCodeRagServer(fakeServer(), db, embedder, indexer, 5, [], new SyncManager(), undefined, undefined, undefined, undefined, { toolset: 'all' });
    await expect(call('add_frontmatter', { filepath: path.join(outside, 'secret.md'), domain: 'x' })).rejects.toBeInstanceOf(PathNotAllowedError);
    expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe(SECRET_MD);
  });
});
