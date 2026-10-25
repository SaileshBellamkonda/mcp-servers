import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorDB } from '../../src/vectordb/db.js';
import { Embedder } from '../../src/embedder/embedder.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { SyncManager } from '../../src/indexer/sync-manager.js';
import { createCodeRagServer } from '../../src/server/coderag-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../.tmp-doc-loaders-integration-test');

const DIMS = 4;

function buildMockFetchFn(): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as { input: string[] };
    const data = body.input.map((_text, index) => ({ index, embedding: [0.1, 0.2, 0.3, 0.4] }));
    return Promise.resolve(
      new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as unknown as typeof fetch;
}

let db: VectorDB;
let indexer: Indexer;
let server: McpServer;

function getHandler(toolName: string) {
  return (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown) => unknown }> })
    ._registeredTools[toolName]!.handler;
}

async function call<T>(toolName: string, input: unknown): Promise<T> {
  const result = (await getHandler(toolName)(input)) as { content: { text: string }[] };
  return JSON.parse(result.content[0]!.text) as T;
}

interface SearchResponse {
  count: number;
  results: {
    document: string;
    chunk: string;
    headingPath?: string[];
    startLine?: number;
    endLine?: number;
    docMetadata?: { title: string; tags: string[]; docType: string };
  }[];
}

const AUTH_MDX = [
  '---',
  'title: Auth Guide',
  'tags: [auth, security]',
  'doc_type: guide',
  '---',
  "import { Note } from './note'",
  '',
  '# Authentication',
  '',
  '## OAuth2 flow',
  '',
  'Exchange the code for a token.',
  '',
  '<Note type="info" />',
].join('\n');

const UI_MD = ['---', 'title: UI', 'tags: [ui]', '---', '# Buttons', '', 'Style the buttons.'].join('\n');

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  const embedder = new Embedder({ url: 'http://localhost:11434/v1', model: 'test', batchSize: 10 }, buildMockFetchFn());
  db = VectorDB.open(':memory:', DIMS);
  indexer = new Indexer(db, embedder, 512);
  server = new McpServer({ name: 'test-coderag', version: '1.0.0' }, { capabilities: { tools: {} } });
  createCodeRagServer(server, db, embedder, indexer, 5, [tmpDir], new SyncManager());
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('mdx documents through the MCP tools', () => {
  it('indexes .mdx and .md, then searches by frontmatter tag with location and metadata in the results', async () => {
    const authPath = path.join(tmpDir, 'auth.mdx');
    const uiPath = path.join(tmpDir, 'ui.md');
    writeFileSync(authPath, AUTH_MDX);
    writeFileSync(uiPath, UI_MD);

    const indexed = await call<{ results: { success: boolean }[] }>('index_markdown', { filepaths: `${authPath},${uiPath}` });
    expect(indexed.results.every((r) => r.success)).toBe(true);

    const data = await call<SearchResponse>('search', { query: 'token', mode: 'keyword', tags: ['auth'] });
    expect(data.count).toBe(1);
    const hit = data.results[0]!;
    expect(hit.document).toBe(authPath);
    expect(hit.headingPath).toEqual(['Authentication', 'OAuth2 flow']);
    expect(hit.startLine).toBe(10);
    expect(hit.docMetadata).toMatchObject({ title: 'Auth Guide', tags: ['auth', 'security'], docType: 'guide' });
    expect(hit.chunk).toContain('Exchange the code for a token.');
    expect(hit.chunk).not.toContain('<Note');
    expect(hit.chunk).not.toContain('import');
  });

  it('excludes documents that lack the requested tag', async () => {
    writeFileSync(path.join(tmpDir, 'auth.mdx'), AUTH_MDX);
    writeFileSync(path.join(tmpDir, 'ui.md'), UI_MD);
    await call('index_markdown', { directory: tmpDir });

    const data = await call<SearchResponse>('search', { query: 'buttons', mode: 'keyword', tags: ['auth'] });
    expect(data.count).toBe(0);

    const unfiltered = await call<SearchResponse>('search', { query: 'buttons', mode: 'keyword' });
    expect(unfiltered.results.map((r) => path.basename(r.document))).toEqual(['ui.md']);
  });

  it('sync_documents picks up .mdx files', async () => {
    writeFileSync(path.join(tmpDir, 'sync-page.mdx'), '# Sync Page\n\nSome synced content.');
    const result = await call<{ success: boolean; indexed: number }>('sync_documents', { directory: tmpDir });
    expect(result.success).toBe(true);
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    expect([...db.listDocuments().keys()].some((f) => f.endsWith('sync-page.mdx'))).toBe(true);
  });

  it('reindex_document re-indexes an .mdx file', async () => {
    const authPath = path.join(tmpDir, 'auth.mdx');
    writeFileSync(authPath, AUTH_MDX);
    await call('index_markdown', { filepath: authPath });

    const result = await call<{ success: boolean }>('reindex_document', { filename: authPath });
    expect(result.success).toBe(true);

    const data = await call<SearchResponse>('search', { query: 'token', mode: 'keyword', tags: ['security'] });
    expect(data.count).toBe(1);
  });
});
