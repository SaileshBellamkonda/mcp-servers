import { afterEach, describe, expect, it } from 'vitest';
import { startMcpHttpServer, type McpHttpServer } from '../../src/index.ts';
import { initializeSession, postJsonRpc, startTestServer } from '../../src/testing/index.ts';
import { INIT_BODY, JSON_HEADERS, makeCountingFactory, rawRequest } from './support.ts';

const TOKEN = `tok-${'x'.repeat(40)}`;
const SESSION_HEADER = 'mcp-session-id';
const running: McpHttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

async function start(options: Parameters<typeof startTestServer>[0] = {}): Promise<Awaited<ReturnType<typeof startTestServer>>> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('session cap (maxSessions)', () => {
  it('answers 429 with Retry-After when full, builds no server for the rejected request, and frees a slot on DELETE', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, maxSessions: 2 });
    const a = await initializeSession(server.url);
    await initializeSession(server.url);
    expect(servers).toHaveLength(2);

    const rejected = await postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(rejected.sessionId).toBeUndefined();
    expect(servers).toHaveLength(2);
    expect(server.sessions.size).toBe(2);

    const del = await fetch(server.url, { method: 'DELETE', headers: { [SESSION_HEADER]: a.sessionId ?? '' } });
    expect(del.status).toBe(200);
    const again = await initializeSession(server.url);
    expect(again.status).toBe(200);
    expect(servers).toHaveLength(3);
  });

  it('never exceeds the cap under concurrent initializes', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, maxSessions: 3 });
    const replies = await Promise.all(
      Array.from({ length: 12 }, () => postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown)),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(3);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(9);
    expect(servers).toHaveLength(3);
    expect(server.sessions.size).toBe(3);
  });

  it('defaults to 64 sessions', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer });
    const replies: number[] = [];
    for (let i = 0; i < 66; i += 1) {
      replies.push((await postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown)).status);
    }
    expect(replies.filter((s) => s === 200)).toHaveLength(64);
    expect(replies.slice(64)).toEqual([429, 429]);
    expect(servers).toHaveLength(64);
  });

  it('answers 401 before 429 when a token is required', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer, token: TOKEN, maxSessions: 1 });
    await initializeSession(server.url, { token: TOKEN });
    expect((await postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown)).status).toBe(401);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid maxSessions of %s', async (maxSessions) => {
    const { createServer } = makeCountingFactory();
    await expect(startMcpHttpServer({ createServer, port: 0, maxSessions })).rejects.toThrow(/maxSessions/);
  });
});

describe('idle expiry (sessionIdleTimeoutMs)', () => {
  it('expires an idle session: the id becomes unknown (404) and its server is closed', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, sessionIdleTimeoutMs: 150 });
    const init = await initializeSession(server.url);
    expect(server.sessions.size).toBe(1);
    await sleep(400);
    expect(server.sessions.size).toBe(0);
    expect(servers[0]?.isConnected()).toBe(false);
    const after = await postJsonRpc(server.url, { jsonrpc: '2.0', id: 2, method: 'ping' }, { headers: { [SESSION_HEADER]: init.sessionId ?? '' } });
    expect(after.status).toBe(404);
  });

  it('resets the timer on every request, so a session in use stays alive', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer, sessionIdleTimeoutMs: 300 });
    const init = await initializeSession(server.url);
    for (let i = 0; i < 6; i += 1) {
      await sleep(100);
      const res = await postJsonRpc(server.url, { jsonrpc: '2.0', id: 10 + i, method: 'ping' }, { headers: { [SESSION_HEADER]: init.sessionId ?? '' } });
      expect(res.status).toBe(200);
    }
    // GET (unrelated to POST) also counts as activity
    await sleep(100);
    expect(server.sessions.has(init.sessionId ?? '')).toBe(true);
    await sleep(500);
    expect(server.sessions.size).toBe(0);
  });

  it('frees a slot of the cap when a session expires', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer, maxSessions: 1, sessionIdleTimeoutMs: 100 });
    await initializeSession(server.url);
    expect((await postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown)).status).toBe(429);
    await sleep(300);
    expect((await postJsonRpc(server.url, JSON.parse(INIT_BODY) as unknown)).status).toBe(200);
  });

  it('can be disabled with 0 and rejects negative or non-finite values', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer, sessionIdleTimeoutMs: 0 });
    await initializeSession(server.url);
    await sleep(100);
    expect(server.sessions.size).toBe(1);
    await expect(startMcpHttpServer({ createServer, port: 0, sessionIdleTimeoutMs: -5 })).rejects.toThrow(/sessionIdleTimeoutMs/);
    await expect(startMcpHttpServer({ createServer, port: 0, sessionIdleTimeoutMs: Number.NaN })).rejects.toThrow(/sessionIdleTimeoutMs/);
  });

  it('stops all idle timers on close()', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await startTestServer({ createServer, sessionIdleTimeoutMs: 60_000 });
    await initializeSession(server.url);
    await server.close();
    expect(servers[0]?.isConnected()).toBe(false);
    expect(server.sessions.size).toBe(0);
  });
});

describe('body limit (maxBodyBytes)', () => {
  it('answers 413 for an oversized declared Content-Length without creating a server', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, maxBodyBytes: 1024 });
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { pad: 'a'.repeat(5000) } });
    const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Length': String(Buffer.byteLength(big)) }, body: big });
    expect(res.status).toBe(413);
    expect(servers).toHaveLength(0);
    expect(server.sessions.size).toBe(0);
  });

  it('answers 413 for an oversized chunked body (no Content-Length) while streaming it', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, maxBodyBytes: 1024 });
    function* chunks(): Generator<string> {
      yield '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"pad":"';
      for (let i = 0; i < 200; i += 1) yield 'a'.repeat(1024);
      yield '"}}';
    }
    const res = await rawRequest({ port: server.port, headers: JSON_HEADERS, chunks: chunks() });
    expect(res.status).toBe(413);
    expect(servers).toHaveLength(0);
  });

  it('accepts a body under the limit, chunked or not', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer, maxBodyBytes: 4096 });
    const plain = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Length': String(Buffer.byteLength(INIT_BODY)) }, body: INIT_BODY });
    expect(plain.status).toBe(200);
    const chunked = await rawRequest({ port: server.port, headers: JSON_HEADERS, chunks: [INIT_BODY.slice(0, 20), INIT_BODY.slice(20)] });
    expect(chunked.status).toBe(200);
  });

  it('allows up to 4 MiB by default and rejects more', async () => {
    const { createServer } = makeCountingFactory();
    const server = await start({ createServer });
    const body = (bytes: number): string => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' }, pad: 'a'.repeat(bytes) } });
    const under = body(3 * 1024 * 1024);
    const ok = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Length': String(Buffer.byteLength(under)) }, body: under });
    expect(ok.status).toBe(200);
    const over = body(5 * 1024 * 1024);
    const rejected = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Length': String(Buffer.byteLength(over)) }, body: over });
    expect(rejected.status).toBe(413);
  });

  it('answers 401 before reading the body when a token is required', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, token: TOKEN, maxBodyBytes: 1024 });
    const big = 'a'.repeat(100_000);
    const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Length': String(big.length) }, body: big });
    expect(res.status).toBe(401);
    expect(servers).toHaveLength(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid maxBodyBytes of %s', async (maxBodyBytes) => {
    const { createServer } = makeCountingFactory();
    await expect(startMcpHttpServer({ createServer, port: 0, maxBodyBytes })).rejects.toThrow(/maxBodyBytes/);
  });
});
