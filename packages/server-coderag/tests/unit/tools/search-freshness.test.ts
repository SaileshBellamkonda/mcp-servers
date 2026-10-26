import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import { IndexFreshness } from '../../../src/indexer/freshness.js';
import type { CodeChunk } from '../../../src/core/types.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-search-freshness-test');
const VEC = [0.9, 0.1, 0.1, 0.1];
const T0 = 1_700_000_000_000;
const silent = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
const file = (name: string): string => path.join(tmpDir, name);

function code(name: string): CodeChunk {
  const signature = `function ${name}(): void`;
  return {
    content: `${signature} {\n  return;\n}`, position: 0, symbolName: name, symbolType: 'function', language: 'typescript',
    startLine: 1, endLine: 3, parentSymbol: '', signature,
  };
}

let db: VectorDB;
let refresh: ReturnType<typeof vi.fn<(p: string) => Promise<boolean>>>;
let freshness: IndexFreshness;
let handler: Handler;

function addFile(name: string, mtimeMs = T0): void {
  writeFileSync(file(name), 'x');
  utimesSync(file(name), new Date(mtimeMs), new Date(mtimeMs));
  db.insertCodeDocument(file(name), new Date(mtimeMs), [code(name.replace(/\.ts$/, ''))], [VEC]);
}

async function run(input: Record<string, unknown>): Promise<string> {
  const response = await handler({ query: 'function', mode: 'keyword', ...input });
  return response.content[0]?.text ?? '';
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', 4);
  refresh = vi.fn<(p: string) => Promise<boolean>>().mockResolvedValue(true);
  freshness = new IndexFreshness(db, { refresh }, { inProgress: false }, silent, { debounceMs: 5 });
  const server = {
    registerTool: (name: string, _config: unknown, h: Handler): void => { if (name === 'search') handler = h; },
  } as unknown as McpServer;
  registerSearch(server, db, { embed: vi.fn().mockResolvedValue(VEC) } as unknown as Embedder, 5, new PathGuard([tmpDir]), freshness);
});

afterEach(() => {
  freshness.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('search result freshness', () => {
  it('leaves hits of unchanged files as they are and schedules no refresh', async () => {
    addFile('kept.ts');
    const out = await run({});
    expect(out).toContain('kept.ts:1-3');
    expect(out).not.toContain('stale');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('omits hits of files that no longer exist and removes their index entries in the background', async () => {
    addFile('kept.ts');
    addFile('gone.ts');
    rmSync(file('gone.ts'));
    const out = await run({});
    expect(out).toContain('kept.ts');
    expect(out).not.toContain('gone.ts');
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledWith(file('gone.ts')); });
    expect(refresh).not.toHaveBeenCalledWith(file('kept.ts'));
  });

  it('keeps the hit of a changed file, marks its header "(stale)", and re-indexes the file in the background', async () => {
    addFile('edited.ts');
    addFile('kept.ts');
    utimesSync(file('edited.ts'), new Date(T0 + 9000), new Date(T0 + 9000));
    const out = await run({});
    const headers = out.split('\n').filter((l) => !l.startsWith(' '));
    expect(headers.find((h) => h.includes('edited.ts'))).toMatch(/\(stale\)$/);
    expect(headers.find((h) => h.includes('kept.ts'))).not.toContain('stale');
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledWith(file('edited.ts')); });
  });

  it('returns before the background refresh has run', async () => {
    addFile('edited.ts');
    utimesSync(file('edited.ts'), new Date(T0 + 9000), new Date(T0 + 9000));
    let release: (ok: boolean) => void = () => undefined;
    refresh.mockReturnValue(new Promise<boolean>((resolve) => { release = resolve; }));
    const out = await run({});
    expect(out).toContain('edited.ts');
    expect(refresh).not.toHaveBeenCalled();
    release(true);
  });

  it('the page still fills up when hits are dropped (top_k counts only existing files)', async () => {
    for (const name of ['a1.ts', 'a2.ts', 'a3.ts', 'a4.ts']) addFile(name);
    rmSync(file('a1.ts'));
    rmSync(file('a2.ts'));
    const out = await run({ top_k: 2 });
    expect(out.split('\n').filter((l) => !l.startsWith(' ') && !l.startsWith('+')).length).toBe(2);
    expect(out).not.toMatch(/a1\.ts|a2\.ts/);
  });

  it('detailed format drops missing files and flags changed ones with stale: true', async () => {
    addFile('edited.ts');
    addFile('gone.ts');
    addFile('kept.ts');
    rmSync(file('gone.ts'));
    utimesSync(file('edited.ts'), new Date(T0 + 9000), new Date(T0 + 9000));
    const parsed = JSON.parse(await run({ response_format: 'detailed' })) as { results: { document: string; stale?: boolean }[] };
    const byName = new Map(parsed.results.map((r) => [path.basename(r.document), r.stale]));
    expect([...byName.keys()].sort()).toEqual(['edited.ts', 'kept.ts']);
    expect(byName.get('edited.ts')).toBe(true);
    expect(byName.get('kept.ts')).toBeUndefined();
  });
});
