import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import type { CodeChunk, DocumentMetadata, MarkdownChunk } from '../../../src/core/types.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

interface Captured {
  handler: Handler;
  inputSchema: unknown;
  description: string;
}

const VEC = [0.9, 0.1, 0.1, 0.1];

function captureSearchTool(db: VectorDB, roots: string[] = ['/']): Captured {
  let captured: Captured | undefined;
  const server = {
    registerTool: (name: string, config: { inputSchema: unknown; description: string }, handler: Handler): void => {
      if (name === 'search') captured = { handler, inputSchema: config.inputSchema, description: config.description };
    },
  } as unknown as McpServer;
  const embedder = { embed: vi.fn().mockResolvedValue(VEC) } as unknown as Embedder;
  registerSearch(server, db, embedder, 5, new PathGuard(roots));
  if (!captured) throw new Error('search tool was not registered');
  return captured;
}

function meta(overrides: Partial<DocumentMetadata>): DocumentMetadata {
  return { title: 'Doc', tags: [], extra: {}, ...overrides };
}

function chunk(content: string, extra: Partial<MarkdownChunk> = {}): MarkdownChunk {
  return { content, position: 0, ...extra };
}

function code(overrides: Partial<CodeChunk> & { symbolName: string }): CodeChunk {
  const signature = overrides.signature ?? `function ${overrides.symbolName}(): void`;
  return {
    content: `${signature} {\n  return;\n}`,
    position: 0,
    symbolType: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 3,
    parentSymbol: '',
    signature,
    ...overrides,
  };
}

async function text(tool: Captured, input: unknown): Promise<string> {
  const response = await tool.handler(input);
  return response.content[0]?.text ?? '';
}

/** Splits the concise text into entries: a header at column 0 followed by indented lines. */
function entries(output: string): { header: string; body: string[] }[] {
  const result: { header: string; body: string[] }[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('  ')) result[result.length - 1]?.body.push(line.slice(2));
    else if (!line.startsWith('+') && line !== '') result.push({ header: line, body: [] });
  }
  return result;
}

function headerPaths(output: string): string[] {
  return entries(output).map((e) => e.header.split(/[: ]/)[0] ?? '');
}

interface DetailedResult {
  document: string;
  headingPath?: string[];
  startLine?: number;
  docMetadata?: { title: string; tags: string[] };
}

async function detailed(tool: Captured, input: Record<string, unknown>): Promise<{ results: DetailedResult[]; count: number; mode: string }> {
  return JSON.parse(await text(tool, { ...input, response_format: 'detailed' })) as { results: DetailedResult[]; count: number; mode: string };
}

let db: VectorDB;

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  db.insertDocument(
    '/docs/auth.md',
    new Date(),
    [chunk('Authentication guide', { headingPath: ['Auth'], startLine: 2, endLine: 4 })],
    [[0.9, 0.1, 0.1, 0.1]],
    meta({ title: 'Auth Guide', tags: ['auth'], docType: 'guide', domain: 'backend', project: 'acme' }),
  );
  db.insertDocument(
    '/docs/ui.md',
    new Date(),
    [chunk('Button guide')],
    [[0.1, 0.9, 0.1, 0.1]],
    meta({ title: 'UI', tags: ['ui'], docType: 'spec', domain: 'frontend', project: 'zen' }),
  );
});

afterEach(() => {
  db.close();
});

describe('search tool', () => {
  it('advertises the metadata filters, paging and format options in its JSON schema', () => {
    const tool = captureSearchTool(db);
    const standard = (
      tool.inputSchema as {
        '~standard': { jsonSchema: { input: (options: { target: string }) => { properties: Record<string, unknown> } } };
      }
    )['~standard'];
    const properties = Object.keys(standard.jsonSchema.input({ target: 'draft-2020-12' }).properties);
    expect(properties).toEqual(expect.arrayContaining(['tags', 'doc_type', 'domain', 'project', 'max_tokens', 'offset', 'response_format']));
  });

  it('keeps the tool description short', () => {
    expect(captureSearchTool(db).description.length).toBeLessThan(400);
  });

  it('filters by tags', async () => {
    const tool = captureSearchTool(db);
    expect(headerPaths(await text(tool, { query: 'guide', mode: 'keyword', tags: ['auth'] }))).toEqual(['docs/auth.md']);
  });

  it('filters by doc_type, domain and project', async () => {
    const tool = captureSearchTool(db);
    expect(headerPaths(await text(tool, { query: 'guide', mode: 'keyword', doc_type: 'spec' }))).toEqual(['docs/ui.md']);
    expect(headerPaths(await text(tool, { query: 'guide', mode: 'keyword', domain: 'backend' }))).toEqual(['docs/auth.md']);
    expect(headerPaths(await text(tool, { query: 'guide', mode: 'keyword', project: 'zen' }))).toEqual(['docs/ui.md']);
  });

  it('shows the heading path and line range of a document hit', async () => {
    const tool = captureSearchTool(db);
    const [hit] = entries(await text(tool, { query: 'authentication', mode: 'keyword' }));
    expect(hit?.header).toMatch(/^docs\/auth\.md:2-4 Auth \(\d\.\d\d\)$/);
    expect(hit?.body).toEqual(['Authentication guide']);
  });

  it('applies no filter for an empty tags array', async () => {
    const tool = captureSearchTool(db);
    expect(entries(await text(tool, { query: 'guide', mode: 'keyword', tags: [] }))).toHaveLength(2);
  });

  it('works with semantic mode and a tag filter', async () => {
    const tool = captureSearchTool(db);
    expect(headerPaths(await text(tool, { query: 'anything', tags: ['ui'] }))).toEqual(['docs/ui.md']);
  });

  it('says so when nothing matches, with a hint for keyword mode', async () => {
    const tool = captureSearchTool(db);
    expect(await text(tool, { query: 'zzzz', mode: 'keyword' })).toMatch(/^No results\./);
    expect(await text(tool, { query: 'zzzz', mode: 'keyword' })).toContain('hybrid');
    expect(await text(tool, { query: 'anything', tags: ['nope'] })).toBe('No results.');
  });
});

describe('search tool, concise output', () => {
  it('prints paths relative to the allowed root, never absolute', async () => {
    db.insertCodeDocument('/repo/src/a.ts', new Date(), [code({ symbolName: 'alpha' })], [VEC]);
    db.insertCodeDocument('/elsewhere/deep/b.ts', new Date(), [code({ symbolName: 'alpha' })], [VEC]);
    const output = await text(captureSearchTool(db, ['/repo']), { query: 'alpha', mode: 'keyword' });
    expect(output).toContain('src/a.ts:1-3');
    expect(output).not.toContain('/repo');
    expect(output).not.toMatch(/(^|\s)\//m);
  });

  it('prefixes a path under a secondary root with that root name', async () => {
    db.insertCodeDocument('/other/lib/b.ts', new Date(), [code({ symbolName: 'beta' })], [VEC]);
    const output = await text(captureSearchTool(db, ['/repo', '/other']), { query: 'beta', mode: 'keyword' });
    expect(headerPaths(output)).toEqual(['other/lib/b.ts']);
  });

  it('labels a code hit with kind, parent and name, then the signature and a snippet after it', async () => {
    const body = Array.from({ length: 12 }, (_, i) => `    const line${String(i)} = ${String(i)};`);
    db.insertCodeDocument('/repo/src/svc.ts', new Date(), [code({
      symbolName: 'find',
      symbolType: 'method',
      parentSymbol: 'Service',
      signature: 'async find(id: string): Promise<Item>',
      content: ['  async find(id: string): Promise<Item> {', ...body, '  }'].join('\n'),
      startLine: 10,
      endLine: 24,
    })], [VEC]);
    const [hit] = entries(await text(captureSearchTool(db, ['/repo']), { query: 'find', mode: 'keyword' }));
    expect(hit?.header).toMatch(/^src\/svc\.ts:10-24 method Service\.find \(\d\.\d\d\)$/);
    expect(hit?.body[0]).toBe('async find(id: string): Promise<Item>');
    // At most 5 snippet lines, starting with the first body line, dedented and without the signature repeated.
    expect(hit?.body.slice(1)).toEqual(['const line0 = 0;', 'const line1 = 1;', 'const line2 = 2;', 'const line3 = 3;', 'const line4 = 4;']);
  });

  it('keeps the snippet of a document hit to the first 3 lines after its heading', async () => {
    db.insertDocument(
      '/repo/docs/guide.md',
      new Date(),
      [chunk('# Setup\n\nStep one.\nStep two.\nStep three.\nStep four.', { headingPath: ['Guide', 'Setup'], startLine: 5, endLine: 12 })],
      [VEC],
      meta({ title: 'Guide' }),
    );
    const [hit] = entries(await text(captureSearchTool(db, ['/repo']), { query: 'step', mode: 'keyword' }));
    expect(hit?.header).toMatch(/^docs\/guide\.md:5-12 Guide > Setup /);
    expect(hit?.body).toEqual(['Step one.', 'Step two.', 'Step three.']);
  });

  it('truncates very long snippet lines', async () => {
    db.insertCodeDocument('/repo/a.ts', new Date(), [code({
      symbolName: 'wide',
      content: `function wide(): void {\n  const x = '${'y'.repeat(400)}';\n}`,
    })], [VEC]);
    const [hit] = entries(await text(captureSearchTool(db, ['/repo']), { query: 'wide', mode: 'keyword' }));
    expect(Math.max(...(hit?.body ?? []).map((l) => l.length))).toBeLessThanOrEqual(120);
  });

  it('omits empty fields and internal noise', async () => {
    db.insertCodeDocument('/repo/a.ts', new Date(), [code({ symbolName: 'plain', signature: '' })], [VEC]);
    const output = await text(captureSearchTool(db, ['/repo']), { query: 'plain', mode: 'keyword' });
    for (const noise of ['undefined', 'null', 'position', 'chunk', 'docMetadata', 'language', '{"']) expect(output).not.toContain(noise);
    expect(entries(output)[0]?.header).not.toContain('.plain');
  });

  it('does not repeat a signature that only restates the kind and name in the header', async () => {
    db.insertCodeDocument('/repo/src/opts.ts', new Date(), [code({
      symbolName: 'Options',
      symbolType: 'interface',
      signature: 'interface Options',
      content: 'interface Options {\n  verbose: boolean;\n}',
    })], [VEC]);
    const [hit] = entries(await text(captureSearchTool(db, ['/repo']), { query: 'verbose', mode: 'keyword' }));
    expect(hit?.header).toContain('interface Options');
    expect(hit?.body).toEqual(['verbose: boolean;']);
  });

  it('rounds the score to two decimals', async () => {
    const [hit] = entries(await text(captureSearchTool(db), { query: 'anything', tags: ['auth'] }));
    expect(hit?.header).toMatch(/ \(\d\.\d\d\)$/);
  });

  it('shows only the method when a class and one of its methods both match', async () => {
    db.insertCodeDocument('/repo/src/store.ts', new Date(), [
      code({ symbolName: 'Store', symbolType: 'class', signature: 'class Store', startLine: 1, endLine: 30, content: 'class Store {\n  // cache lookup\n}', position: 0 }),
      code({ symbolName: 'lookup', symbolType: 'method', parentSymbol: 'Store', signature: 'lookup(key: string): string', startLine: 5, endLine: 9, content: 'lookup(key: string): string {\n  // cache lookup\n}', position: 1 }),
    ], [VEC, VEC]);
    const output = await text(captureSearchTool(db, ['/repo']), { query: 'cache lookup', mode: 'keyword' });
    const headers = entries(output).map((e) => e.header);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('method Store.lookup');
    expect(output).not.toContain('class Store');
  });

  it('still shows a class when none of its members matched', async () => {
    db.insertCodeDocument('/repo/src/store.ts', new Date(), [
      code({ symbolName: 'Store', symbolType: 'class', signature: 'class Store', startLine: 1, endLine: 30, content: 'class Store {\n  // cache holder\n}' }),
    ], [VEC]);
    const [hit] = entries(await text(captureSearchTool(db, ['/repo']), { query: 'holder', mode: 'keyword' }));
    expect(hit?.header).toContain('class Store');
  });

  describe('budget and paging', () => {
    beforeEach(() => {
      const chunks = Array.from({ length: 8 }, (_, i) => code({
        symbolName: `handler${String(i)}`,
        position: i,
        startLine: i * 10 + 1,
        endLine: i * 10 + 9,
        content: `function handler${String(i)}(): void {\n  // shared token\n  const a = ${'x'.repeat(10 + i)};\n}`,
      }));
      db.insertCodeDocument('/repo/src/many.ts', new Date(), chunks, chunks.map(() => VEC));
    });

    it('stops adding results at max_tokens and appends one line with the remainder and next offset', async () => {
      const tool = captureSearchTool(db, ['/repo']);
      const output = await text(tool, { query: 'shared token', mode: 'keyword', top_k: 8, max_tokens: 100 });
      const shown = entries(output).length;
      expect(shown).toBeGreaterThanOrEqual(1);
      expect(shown).toBeLessThan(8);
      expect(output.length).toBeLessThanOrEqual(100 * 4);
      const lines = output.trimEnd().split('\n');
      expect(lines.at(-1)).toBe(`+${String(8 - shown)} more results; narrow the query or pass offset=${String(shown)}`);
    });

    it('defaults to a 1500 token budget', async () => {
      const long = Array.from({ length: 12 }, (_, i) => code({
        symbolName: `big${String(i)}`,
        position: i,
        signature: `function big${String(i)}(${'argument: string, '.repeat(10)}): void`,
        content: `function big${String(i)}() {\n  // bulk marker\n${Array.from({ length: 20 }, (_, j) => `  const value${String(j)} = '${'z'.repeat(100)}';`).join('\n')}\n}`,
      }));
      db.insertCodeDocument('/repo/src/big.ts', new Date(), long, long.map(() => VEC));
      const output = await text(captureSearchTool(db, ['/repo']), { query: 'bulk marker', mode: 'keyword', top_k: 12 });
      expect(entries(output).length).toBeGreaterThan(1);
      expect(output.length).toBeLessThanOrEqual(1500 * 4);
      expect(output).toContain('more results');
    });

    it('always returns the first result, trimmed to the budget when needed', async () => {
      const output = await text(captureSearchTool(db, ['/repo']), { query: 'shared token', mode: 'keyword', max_tokens: 1 });
      expect(entries(output).length).toBe(1);
    });

    it('does not append the line when everything fits', async () => {
      const output = await text(captureSearchTool(db, ['/repo']), { query: 'shared token', mode: 'keyword', top_k: 3 });
      expect(output).not.toContain('more results');
    });

    it('pages with offset: consecutive pages are disjoint and together equal the full ranking', async () => {
      const tool = captureSearchTool(db, ['/repo']);
      const all = headerPaths(await text(tool, { query: 'shared token', mode: 'keyword', top_k: 6 }));
      const headersOf = async (offset: number): Promise<string[]> =>
        entries(await text(tool, { query: 'shared token', mode: 'keyword', top_k: 3, offset })).map((e) => e.header.split(' ').slice(0, 3).join(' '));
      const full = entries(await text(tool, { query: 'shared token', mode: 'keyword', top_k: 6 })).map((e) => e.header.split(' ').slice(0, 3).join(' '));
      const first = await headersOf(0);
      const second = await headersOf(3);
      expect(all).toHaveLength(6);
      expect([...first, ...second]).toEqual(full);
      expect(new Set([...first, ...second]).size).toBe(6);
    });

    it('returns no results past the end', async () => {
      expect(await text(captureSearchTool(db, ['/repo']), { query: 'shared token', mode: 'keyword', offset: 50 })).toMatch(/^No results/);
    });
  });
});

describe('search tool, detailed output', () => {
  it('returns the full JSON shape with absolute paths, whole chunks and metadata', async () => {
    const tool = captureSearchTool(db);
    const data = await detailed(tool, { query: 'authentication', mode: 'keyword' });
    expect(data).toMatchObject({ count: 1, mode: 'keyword' });
    expect(data.results[0]).toMatchObject({
      document: '/docs/auth.md',
      headingPath: ['Auth'],
      startLine: 2,
      docMetadata: { title: 'Auth Guide', tags: ['auth'] },
    });
  });

  it('is byte-identical to the previous response format', async () => {
    const tool = captureSearchTool(db);
    const expected = JSON.stringify({ results: db.searchByKeyword('guide', 5, null), count: 2, mode: 'keyword' }, null, 2);
    expect(await text(tool, { query: 'guide', mode: 'keyword', response_format: 'detailed' })).toBe(expected);
  });

  it('supports offset and keeps both class and method', async () => {
    db.insertCodeDocument('/repo/src/store.ts', new Date(), [
      code({ symbolName: 'Store', symbolType: 'class', signature: 'class Store', startLine: 1, endLine: 30, content: 'class Store { cache lookup }' }),
      code({ symbolName: 'lookup', symbolType: 'method', parentSymbol: 'Store', startLine: 5, endLine: 9, position: 1, content: 'lookup() { cache lookup }' }),
    ], [VEC, VEC]);
    const tool = captureSearchTool(db, ['/repo']);
    const all = await detailed(tool, { query: 'cache lookup', mode: 'keyword' });
    expect(all.count).toBe(2);
    const rest = await detailed(tool, { query: 'cache lookup', mode: 'keyword', offset: 1 });
    expect(rest.results).toEqual(all.results.slice(1));
  });
});
