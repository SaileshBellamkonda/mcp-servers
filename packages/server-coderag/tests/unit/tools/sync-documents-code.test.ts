import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { PathGuard } from '../../../src/core/path-guard.ts';
import { registerSyncDocuments } from '../../../src/tools/sync-documents.ts';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-sync-documents-code-test');
const DIM = 4;

function embedder(): Embedder {
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

let db: VectorDB;
let indexer: Indexer;
let handler: Handler;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', DIM);
  const fwd = tmpDir.replace(/\\/g, '/');
  indexer = new Indexer(db, embedder(), 500, { codeMatcher: new GlobMatcher([`${fwd}/**/*.ts`], [], tmpDir) });
  const server = { registerTool: (_name: string, _config: unknown, h: Handler): void => { handler = h; } } as unknown as McpServer;
  registerSyncDocuments(server, db, indexer, [tmpDir], new SyncManager(), new PathGuard([tmpDir]));
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function sync(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse((await handler(input)).content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('sync_documents also refreshes code when no directory is given', () => {
  it('indexes new and changed source files, removes deleted ones and reports them under "code"', async () => {
    writeFileSync(path.join(tmpDir, 'a.ts'), 'export function alpha(): number { return 1; }\n');
    writeFileSync(path.join(tmpDir, 'b.ts'), 'export function beta(): number { return 2; }\n');
    const first = await sync({});
    expect(first['code']).toEqual({ indexed: 2, skipped: 0, failed: 0, removed: 0 });

    rmSync(path.join(tmpDir, 'b.ts'));
    writeFileSync(path.join(tmpDir, 'c.ts'), 'export function gamma(): number { return 3; }\n');
    const second = await sync({});
    expect(second['code']).toEqual({ indexed: 1, skipped: 1, failed: 0, removed: 1 });
    expect([...db.listDocumentsByType('code').keys()].map((f) => path.basename(f)).sort()).toEqual(['a.ts', 'c.ts']);
  });

  it('leaves code alone when a single directory is requested', async () => {
    writeFileSync(path.join(tmpDir, 'a.ts'), 'export function alpha(): number { return 1; }\n');
    const result = await sync({ directory: tmpDir });
    expect(result['code']).toBeUndefined();
    expect(db.getDocumentCountByType('code')).toBe(0);
  });
});
