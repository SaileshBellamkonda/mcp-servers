import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import type { DocumentMetadata, MarkdownChunk } from '../../../src/core/types.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

interface Captured {
  handler: Handler;
  inputSchema: unknown;
}

function captureSearchTool(db: VectorDB): Captured {
  let captured: Captured | undefined;
  const server = {
    registerTool: (name: string, config: { inputSchema: unknown }, handler: Handler): void => {
      if (name === 'search') captured = { handler, inputSchema: config.inputSchema };
    },
  } as unknown as McpServer;
  const embedder = { embed: vi.fn().mockResolvedValue([0.9, 0.1, 0.1, 0.1]) } as unknown as Embedder;
  registerSearch(server, db, embedder, 5);
  if (!captured) throw new Error('search tool was not registered');
  return captured;
}

function meta(overrides: Partial<DocumentMetadata>): DocumentMetadata {
  return { title: 'Doc', tags: [], extra: {}, ...overrides };
}

function chunk(content: string, extra: Partial<MarkdownChunk> = {}): MarkdownChunk {
  return { content, position: 0, ...extra };
}

interface ParsedResult {
  document: string;
  headingPath?: string[];
  startLine?: number;
  docMetadata?: { title: string; tags: string[] };
}

async function run(tool: Captured, input: unknown): Promise<{ results: ParsedResult[]; count: number }> {
  const response = await tool.handler(input);
  return JSON.parse(response.content[0]?.text ?? '{}') as { results: ParsedResult[]; count: number };
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
  it('advertises the metadata filters in its JSON schema', () => {
    const tool = captureSearchTool(db);
    const standard = (
      tool.inputSchema as {
        '~standard': { jsonSchema: { input: (options: { target: string }) => { properties: Record<string, unknown> } } };
      }
    )['~standard'];
    const properties = Object.keys(standard.jsonSchema.input({ target: 'draft-2020-12' }).properties);
    expect(properties).toEqual(expect.arrayContaining(['tags', 'doc_type', 'domain', 'project']));
  });

  it('filters by tags', async () => {
    const tool = captureSearchTool(db);
    const data = await run(tool, { query: 'guide', mode: 'keyword', tags: ['auth'] });
    expect(data.results.map((r) => r.document)).toEqual(['/docs/auth.md']);
  });

  it('filters by doc_type, domain and project', async () => {
    const tool = captureSearchTool(db);
    expect((await run(tool, { query: 'guide', mode: 'keyword', doc_type: 'spec' })).results.map((r) => r.document)).toEqual(['/docs/ui.md']);
    expect((await run(tool, { query: 'guide', mode: 'keyword', domain: 'backend' })).results.map((r) => r.document)).toEqual(['/docs/auth.md']);
    expect((await run(tool, { query: 'guide', mode: 'keyword', project: 'zen' })).results.map((r) => r.document)).toEqual(['/docs/ui.md']);
  });

  it('returns heading path, line numbers and document metadata', async () => {
    const tool = captureSearchTool(db);
    const data = await run(tool, { query: 'authentication', mode: 'keyword' });
    expect(data.results[0]).toMatchObject({
      document: '/docs/auth.md',
      headingPath: ['Auth'],
      startLine: 2,
      docMetadata: { title: 'Auth Guide', tags: ['auth'] },
    });
  });

  it('applies no filter for an empty tags array', async () => {
    const tool = captureSearchTool(db);
    const data = await run(tool, { query: 'guide', mode: 'keyword', tags: [] });
    expect(data.count).toBe(2);
  });

  it('works with semantic mode and a tag filter', async () => {
    const tool = captureSearchTool(db);
    const data = await run(tool, { query: 'anything', tags: ['ui'] });
    expect(data.results.map((r) => r.document)).toEqual(['/docs/ui.md']);
  });
});
