import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import { IndexFreshness } from '../../../src/indexer/freshness.js';
import type { CodeChunk } from '../../../src/core/types.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const ROOT = '/fake-root';
const MTIME = new Date(1_700_000_000_000);
const silent = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
const QUERY_VEC = [1, 0, 0, 0];

/** Vector at angle `step` away from the query vector: a larger step ranks lower. */
function vec(step: number): number[] {
  const angle = step * 0.05;
  return [Math.cos(angle), Math.sin(angle), 0, 0];
}

function code(name: string): CodeChunk {
  const signature = `function ${name}(): void`;
  return {
    content: `${signature} {\n  return;\n}`, position: 0, symbolName: name, symbolType: 'function', language: 'typescript',
    startLine: 1, endLine: 3, parentSymbol: '', signature,
  };
}

let db: VectorDB;
let existing: Set<string>;
let freshness: IndexFreshness;
let embed: ReturnType<typeof vi.fn<(q: string) => Promise<number[]>>>;
let handler: Handler;

/** Rows `gone0..` rank before `kept0..`; the gone ones are not in the fake file system. */
function populate(goneCount: number, keptCount: number): void {
  let step = 0;
  for (let i = 0; i < goneCount; i++) {
    const file = `${ROOT}/gone${String(i)}.ts`;
    db.insertCodeDocument(file, MTIME, [code(`gone${String(i)}`)], [vec(step++)]);
  }
  for (let i = 0; i < keptCount; i++) {
    const file = `${ROOT}/kept${String(i)}.ts`;
    existing.add(file);
    db.insertCodeDocument(file, MTIME, [code(`kept${String(i)}`)], [vec(step++)]);
  }
}

async function run(input: Record<string, unknown>): Promise<string> {
  const response = await handler({ query: 'function', mode: 'semantic', ...input });
  return response.content[0]?.text ?? '';
}

const headers = (out: string): string[] => out.split('\n').filter((l) => !l.startsWith(' ') && !l.startsWith('+'));

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  existing = new Set();
  const stat = (file: string): { mtime: Date } => {
    if (!existing.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { mtime: MTIME };
  };
  freshness = new IndexFreshness(db, { refresh: vi.fn().mockResolvedValue(true) }, { inProgress: false }, silent, { debounceMs: 60_000, stat });
  embed = vi.fn<(q: string) => Promise<number[]>>().mockResolvedValue(QUERY_VEC);
  const server = {
    registerTool: (name: string, _config: unknown, h: Handler): void => { if (name === 'search') handler = h; },
  } as unknown as McpServer;
  registerSearch(server, db, { embed } as unknown as Embedder, 5, new PathGuard([ROOT]), freshness);
});

afterEach(() => {
  freshness.close();
  db.close();
});

describe('search refetches after dropping hits of deleted files', () => {
  it('fills the page from further candidates when the first batch was all deleted files', async () => {
    populate(4, 6); // top_k 2 fetches 4 candidates first: all of them gone
    const out = await run({ top_k: 2 });
    expect(headers(out)).toHaveLength(2);
    expect(out).toContain('kept0.ts');
    expect(out).toContain('kept1.ts');
    expect(out).not.toContain('gone');
  });

  it('retrieves a second time, once, with a larger limit, and embeds the query only once', async () => {
    populate(4, 6);
    const spy = vi.spyOn(db, 'searchWithFilter');
    await run({ top_k: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
    const [first, second] = spy.mock.calls.map((c) => c[1]);
    expect(first).toBe(4);
    expect(second).toBeGreaterThan(first as number);
    expect(second).toBeLessThanOrEqual((first as number) + 4 + 10);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('does not retrieve again when nothing was dropped', async () => {
    populate(0, 6);
    const spy = vi.spyOn(db, 'searchWithFilter');
    await run({ top_k: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retrieve again when drops left the page full', async () => {
    populate(1, 6);
    const spy = vi.spyOn(db, 'searchWithFilter');
    const out = await run({ top_k: 2 });
    expect(headers(out)).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is never a loop: when every candidate is gone it stops after the second pass', async () => {
    populate(30, 0);
    const spy = vi.spyOn(db, 'searchWithFilter');
    const out = await run({ top_k: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toBe('No results.');
  });

  it('keyword and hybrid modes refetch as well', async () => {
    populate(4, 6);
    for (const mode of ['keyword', 'hybrid']) {
      const out = await run({ top_k: 2, mode });
      expect(headers(out), mode).toHaveLength(2);
      expect(out, mode).not.toContain('gone');
    }
  });

  it('detailed format refills the page too', async () => {
    populate(6, 6);
    const out = await run({ top_k: 3, response_format: 'detailed' });
    const parsed = JSON.parse(out) as { results: { document: string }[]; count: number };
    expect(parsed.count).toBe(3);
    expect(parsed.results.every((r) => r.document.includes('kept'))).toBe(true);
  });

  it('respects offset after dropping', async () => {
    populate(4, 6);
    const out = await run({ top_k: 2, offset: 2 });
    expect(out).toContain('kept2.ts');
    expect(out).toContain('kept3.ts');
    expect(out).not.toContain('kept1.ts');
  });

  it('never grows beyond the max_tokens budget', async () => {
    populate(10, 12);
    const out = await run({ top_k: 10, max_tokens: 120 });
    expect(out.length).toBeLessThanOrEqual(120 * 4);
    expect(out).toContain('more results');
    expect(out).not.toContain('gone');
  });
});
