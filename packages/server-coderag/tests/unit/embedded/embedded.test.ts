import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';

vi.mock('../../../src/indexer/sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/indexer/sync.js')>();
  return { ...original, runStartupSync: vi.fn().mockResolvedValue(undefined) };
});

import { activateCodeRagServer, deactivateCodeRagServer, type CodeRagServerInstance } from '../../../src/embedded.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Indexer } from '../../../src/indexer/indexer.js';

const TOKEN = `embedded-token-${'e'.repeat(32)}`;
const silent = { debug: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined };

function vsConfig(extra: Record<string, unknown> = {}): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    embeddingUrl: 'http://127.0.0.1:9/v1',
    embeddingModel: 'test-model',
    dbPath: ':memory:',
    embeddingDim: 4,
    ...extra,
  };
  return { get: (key: string) => values[key] };
}

function urlOf(instance: CodeRagServerInstance): string {
  return `http://${instance.host}:${String(instance.port)}/mcp`;
}

async function callTool(url: string, sessionId: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const reply = await postJsonRpc(
    url,
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sessionId } },
  );
  expect(reply.status).toBe(200);
  const result = (reply.message as { result?: { content?: { text: string }[] } }).result;
  return result?.content?.[0]?.text ?? '';
}

describe('activateCodeRagServer', () => {
  let workspace: string;
  let instance: CodeRagServerInstance | undefined;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'coderag-embedded-'));
    mkdirSync(workspace, { recursive: true });
  });

  afterEach(async () => {
    if (instance) await deactivateCodeRagServer(instance);
    instance = undefined;
    vi.restoreAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  const base = (): { vsCodeConfig: ReturnType<typeof vsConfig>; workspaceFolders: string[]; port: number; authToken: string; logger: typeof silent } => ({
    vsCodeConfig: vsConfig(),
    workspaceFolders: [workspace],
    port: 0,
    authToken: TOKEN,
    logger: silent,
  });

  it('rejects a missing token', async () => {
    const options: Record<string, unknown> = { ...base() };
    delete options['authToken'];
    await expect(activateCodeRagServer(options as never)).rejects.toThrow(/token is required/);
  });

  it('rejects an empty or short token without echoing it', async () => {
    await expect(activateCodeRagServer({ ...base(), authToken: '' })).rejects.toThrow(/token is required/);
    const attempt = activateCodeRagServer({ ...base(), authToken: 'short-secret' });
    await expect(attempt).rejects.toThrow(/at least 32/);
    await expect(attempt).rejects.not.toThrow(/short-secret/);
  });

  it('rejects empty workspace folders instead of falling back to the working directory', async () => {
    await expect(activateCodeRagServer({ ...base(), workspaceFolders: [] })).rejects.toThrow(/workspace folder/i);
  });

  it('answers 401 without the token and initializes with it', async () => {
    instance = await activateCodeRagServer(base());
    expect(instance.host).toBe('127.0.0.1');
    expect((await initializeSession(urlOf(instance))).status).toBe(401);
    expect((await initializeSession(urlOf(instance), { token: `${TOKEN}x` })).status).toBe(401);
    const ok = await initializeSession(urlOf(instance), { token: TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.sessionId).toBeTruthy();
  });

  it('serves concurrent sessions that share the same services', async () => {
    instance = await activateCodeRagServer(base());
    const url = urlOf(instance);
    const [a, b] = await Promise.all([initializeSession(url, { token: TOKEN }), initializeSession(url, { token: TOKEN })]);
    expect(a.sessionId).not.toBe(b.sessionId);
    const [statusA, statusB] = await Promise.all([
      callTool(url, a.sessionId ?? '', 'get_index_status'),
      callTool(url, b.sessionId ?? '', 'get_index_status'),
    ]);
    expect(JSON.parse(statusA)).toMatchObject({ embedding_model: 'test-model', embedding_dim: 4 });
    expect(JSON.parse(statusB)).toMatchObject({ embedding_model: 'test-model', embedding_dim: 4 });
  });

  it('confines file tools to every workspace folder', async () => {
    const second = mkdtempSync(path.join(tmpdir(), 'coderag-embedded-b-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'coderag-embedded-out-'));
    try {
      writeFileSync(path.join(second, 'note.md'), '# Note\n\nbody\n');
      writeFileSync(path.join(outside, 'secret.md'), '# Secret\n');
      instance = await activateCodeRagServer({ ...base(), workspaceFolders: [workspace, second] });
      const url = urlOf(instance);
      const { sessionId } = await initializeSession(url, { token: TOKEN });
      const sid = sessionId ?? '';
      const inSecond = await callTool(url, sid, 'add_frontmatter', { filepath: path.join(second, 'note.md'), domain: 'backend' });
      expect(inSecond).toContain('"success":true');
      const denied = await callTool(url, sid, 'add_frontmatter', { filepath: path.join(outside, 'secret.md'), domain: 'backend' });
      expect(denied).toMatch(/outside the allowed roots/);
      expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe('# Secret\n');
    } finally {
      rmSync(second, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('uses the apiKey option for embedding requests, overriding the configured key', async () => {
    const seen: (string | undefined)[] = [];
    const embeddingServer: Server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }] }));
      });
    });
    await new Promise<void>((resolve) => { embeddingServer.listen(0, '127.0.0.1', resolve); });
    try {
      const { port } = embeddingServer.address() as { port: number };
      instance = await activateCodeRagServer({
        ...base(),
        vsCodeConfig: vsConfig({ embeddingUrl: `http://127.0.0.1:${String(port)}/v1`, embeddingApiKey: 'config-key' }),
        apiKey: 'secret-storage-key',
      });
      const url = urlOf(instance);
      const { sessionId } = await initializeSession(url, { token: TOKEN });
      await callTool(url, sessionId ?? '', 'search', { query: 'anything' });
      expect(seen).toEqual(['Bearer secret-storage-key']);
    } finally {
      await new Promise<void>((resolve) => { embeddingServer.close(() => { resolve(); }); });
    }
  });

  it('close() frees the port and closes the indexer and the database', async () => {
    const closeDb = vi.spyOn(VectorDB.prototype, 'close');
    const closeIndexer = vi.spyOn(Indexer.prototype, 'close');
    instance = await activateCodeRagServer(base());
    const url = urlOf(instance);
    await instance.close();
    instance = undefined;
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(closeIndexer).toHaveBeenCalledTimes(1);
    await expect(initializeSession(url, { token: TOKEN })).rejects.toThrow();
  });

  it('deactivateCodeRagServer delegates to close()', async () => {
    instance = await activateCodeRagServer(base());
    const closeSpy = vi.spyOn(instance, 'close');
    await deactivateCodeRagServer(instance);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    instance = undefined;
  });

  it('threads nativeModulesDir into the sqlite-vec loader', async () => {
    const stub = path.join(workspace, 'native', 'node_modules', 'sqlite-vec');
    mkdirSync(stub, { recursive: true });
    writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'sqlite-vec', main: 'index.js' }));
    writeFileSync(path.join(stub, 'index.js'), "module.exports = { load() { throw new Error('stub-sqlite-vec-used'); } };\n");
    await expect(activateCodeRagServer({ ...base(), nativeModulesDir: path.join(workspace, 'native') }))
      .rejects.toThrow(/stub-sqlite-vec-used/);
  });
});
