import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import { PathGuard } from '../../../src/core/path-guard.ts';
import { createCodeRagServer } from '../../../src/server/coderag-server.ts';

const API_KEY = 'sk-live-SUPERSECRET-1234567890';

type Handler = (input: unknown) => unknown;

let upstream: http.Server;
let upstreamUrl: string;
let upstreamBody: (authorization: string) => string;
let dir: string;
let db: VectorDB;
let handlers: Map<string, Handler>;

beforeEach(async () => {
  upstreamBody = (authorization) => `invalid credentials: ${authorization}`;
  upstream = http.createServer((req, res) => {
    const authorization = req.headers.authorization ?? '';
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end(upstreamBody(authorization));
  });
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve); });
  upstreamUrl = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}/v1`;

  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'coderag-redact-')));
  writeFileSync(path.join(dir, 'doc.md'), '# Doc\n\nSome text to embed.\n');
  db = VectorDB.open(':memory:', 4);
});

afterEach(async () => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((resolve) => { upstream.close(() => { resolve(); }); });
});

function makeEmbedder(): Embedder {
  return new Embedder({ url: upstreamUrl, model: 'm', batchSize: 10, apiKey: API_KEY });
}

async function embedError(embedder: Embedder): Promise<string> {
  return await embedder.embed('hello').then(() => 'no error', (err: unknown) => (err as Error).message);
}

describe('Embedder error messages', () => {
  it('never contains the API key when the upstream echoes the Authorization header', async () => {
    const message = await embedError(makeEmbedder());
    expect(message).toContain('401');
    expect(message).not.toContain(API_KEY);
    expect(message).not.toContain('SUPERSECRET');
  });

  it('redacts any Bearer token, not just the configured key', async () => {
    upstreamBody = () => 'got header Bearer abc.DEF-123_xyz/+= and more';
    const message = await embedError(makeEmbedder());
    expect(message).not.toContain('abc.DEF-123_xyz');
    expect(message).toContain('[REDACTED]');
  });

  it('redacts the bare key when it appears without the Bearer prefix', async () => {
    upstreamBody = () => `bad key ${API_KEY} rejected`;
    expect(await embedError(makeEmbedder())).not.toContain('SUPERSECRET');
  });

  it('truncates a long upstream body', async () => {
    upstreamBody = () => 'x'.repeat(5000);
    const message = await embedError(makeEmbedder());
    expect(message.length).toBeLessThan(400);
  });

  it('cannot leak a key that straddles the truncation boundary', async () => {
    upstreamBody = () => `${'y'.repeat(190)}${API_KEY}`;
    const message = await embedError(makeEmbedder());
    expect(message).not.toContain('SUPERSECRET');
    expect(message).not.toContain('sk-live');
  });
});

describe('tool results', () => {
  function fakeServer(): McpServer {
    handlers = new Map();
    return {
      registerTool: (name: string, _config: unknown, handler: Handler): void => { handlers.set(name, handler); },
      sendLoggingMessage: () => Promise.resolve(),
    } as unknown as McpServer;
  }

  it('index_markdown and search never expose the key', async () => {
    const embedder = makeEmbedder();
    const guard = new PathGuard([dir]);
    const warnings: string[] = [];
    const logger = { info: vi.fn(), warning: (m: unknown) => { warnings.push(String(m)); }, error: vi.fn(), debug: vi.fn() };
    const indexer = new Indexer(db, embedder, 500, { pathGuard: guard, logger });
    createCodeRagServer(fakeServer(), db, embedder, indexer, 5, [dir], new SyncManager(), undefined, undefined, undefined, guard, { toolset: 'all' });

    const indexed = (await Promise.resolve(handlers.get('index_markdown')?.({ filepath: path.join(dir, 'doc.md') }))) as { content: { text: string }[] };
    const indexedText = indexed.content[0]?.text ?? '';
    expect(indexedText).toContain('401');
    expect(indexedText).not.toContain('SUPERSECRET');

    const searched = await Promise.resolve().then(() => handlers.get('search')?.({ query: 'text', mode: 'semantic' })).then(
      (res) => JSON.stringify(res),
      (err: unknown) => String(err),
    );
    expect(searched).not.toContain('SUPERSECRET');
    expect(warnings.join('\n')).not.toContain('SUPERSECRET');
  });
});
