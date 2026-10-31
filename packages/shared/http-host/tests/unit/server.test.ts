import { request as httpRequest } from 'node:http';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import {
  HttpSecurityError,
  startMcpHttpServer,
  type McpHttpServer,
  type SessionInfo,
} from '../../src/index.ts';
import { initializeSession, openEventStream, postJsonRpc, startTestServer } from '../../src/testing/index.ts';

const TOKEN = `tok-${'x'.repeat(40)}`;
const SESSION_HEADER = 'mcp-session-id';
const silent = { info: () => undefined, warning: () => undefined, error: () => undefined };

const running: McpHttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

async function start(options: Parameters<typeof startTestServer>[0] = {}): Promise<Awaited<ReturnType<typeof startTestServer>>> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

function makeFactory(): { servers: McpServer[]; createServer: () => McpServer } {
  const servers: McpServer[] = [];
  const createServer = (): McpServer => {
    const index = servers.length;
    const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { logging: {} } });
    server.registerTool('whoami', { description: 'returns a per-server marker' }, () => ({
      content: [{ type: 'text' as const, text: `server-${String(index)}` }],
    }));
    servers.push(server);
    return server;
  };
  return { servers, createServer };
}

function callWhoAmI(url: string, sessionId: string, token?: string): ReturnType<typeof postJsonRpc> {
  return postJsonRpc(
    url,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
    { headers: { [SESSION_HEADER]: sessionId, ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  );
}

function rawStatus(port: number, headers: Record<string, string>, hostname = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: '/mcp', method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startMcpHttpServer without a token', () => {
  it('serves requests on the loopback address', async () => {
    const server = await start();
    const init = await initializeSession(server.url);
    expect(init.status).toBe(200);
    expect(init.sessionId).toBeTruthy();
    expect(server.sessions.has(init.sessionId ?? '')).toBe(true);
  });

  it('binds 127.0.0.1 by default and reports the real port when asked for port 0', async () => {
    const server = await start();
    expect(server.host).toBe('127.0.0.1');
    expect(server.address.address).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).toBe(server.address.port);
  });

  it('is not reachable through a non-loopback interface address', async (ctx) => {
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === 'IPv4' && !i.internal);
    if (!external) {
      ctx.skip();
      return;
    }
    const server = await start();
    await expect(rawStatus(server.port, {}, external.address)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('rejects a foreign Host header on a loopback bind', async () => {
    const server = await start();
    expect(await rawStatus(server.port, { Host: 'evil.example' })).toBe(403);
  });

  it('logs the bound address, auth disabled and a warning, once each', async () => {
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    await start({ logger });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(String(logger.info.mock.calls[0]?.[0])).toMatch(/127\.0\.0\.1:\d+\/mcp.*auth: disabled/);
    expect(logger.warning).toHaveBeenCalledTimes(1);
    expect(String(logger.warning.mock.calls[0]?.[0])).toMatch(/any local process/);
  });
});

describe('host handling', () => {
  it('validates the Host header for any loopback spelling, not only 127.0.0.1', async () => {
    const server = await start({ host: '127.0.0.2' });
    expect(server.address.address).toBe('127.0.0.2');
    expect(await rawStatus(server.port, { Host: `127.0.0.2:${String(server.port)}` }, '127.0.0.2')).toBe(400);
    expect(await rawStatus(server.port, { Host: 'evil.example' }, '127.0.0.2')).toBe(403);
  });

  it('stays silent on stderr when no logger is supplied', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { createServer } = makeFactory();
    const server = await startMcpHttpServer({ createServer, port: 0 });
    running.push(server);
    await postJsonRpc(`http://127.0.0.1:${String(server.port)}/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { 'mcp-session-id': 'x' } });
    expect(write).not.toHaveBeenCalled();
  });

  it('reports startup and the unauthenticated warning to the supplied logger', async () => {
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const { createServer } = makeFactory();
    const server = await startMcpHttpServer({ createServer, port: 0, logger });
    running.push(server);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/auth: disabled/));
    expect(logger.warning).toHaveBeenCalledWith(expect.stringMatching(/any local process/));
  });

  it('logs errors through the supplied logger, not stderr', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const server = await startMcpHttpServer({ createServer: () => { throw new Error('kaboom'); }, port: 0, logger });
    running.push(server);
    await postJsonRpc(`http://127.0.0.1:${String(server.port)}/mcp`, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/kaboom/));
    expect(write).not.toHaveBeenCalled();
  });
});

describe('startMcpHttpServer with a token', () => {
  it('answers 401 for a missing header, a wrong token, a wrong scheme, an empty bearer, a different length and a prefix', async () => {
    const server = await start({ token: TOKEN });
    const attempts: (string | undefined)[] = [
      undefined,
      `Bearer ${'y'.repeat(TOKEN.length)}`,
      `Basic ${TOKEN}`,
      'Bearer ',
      `Bearer ${TOKEN}extra`,
      `Bearer ${TOKEN.slice(0, 20)}`,
    ];
    for (const authorization of attempts) {
      const res = await postJsonRpc(server.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, {
        headers: authorization === undefined ? {} : { Authorization: authorization },
      });
      expect(res.status, String(authorization)).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(res.text).not.toContain(TOKEN);
      if (authorization) expect(res.text).not.toContain(authorization);
    }
    expect(server.sessions.size).toBe(0);
  });

  it('accepts the correct token with a lower-case scheme', async () => {
    const server = await start({ token: TOKEN });
    const res = await postJsonRpc(
      server.url,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } },
      { headers: { Authorization: `bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(200);
  });

  it('protects unknown paths and every method', async () => {
    const server = await start({ token: TOKEN });
    const base = server.url.replace(/\/mcp$/, '');
    expect((await fetch(`${base}/anything`)).status).toBe(401);
    expect((await fetch(server.url, { method: 'GET' })).status).toBe(401);
    expect((await fetch(server.url, { method: 'DELETE' })).status).toBe(401);
    const authed = await fetch(`${base}/anything`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(authed.status).toBe(404);
  });

  it('never writes the token to the logger', async () => {
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const server = await start({ token: TOKEN, logger });
    await initializeSession(server.url, { token: TOKEN });
    await postJsonRpc(server.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Authorization: 'Bearer nope' } });
    const output = JSON.stringify([...logger.info.mock.calls, ...logger.warning.mock.calls, ...logger.error.mock.calls]);
    expect(output).not.toContain(TOKEN);
    expect(String(logger.info.mock.calls[0]?.[0])).toMatch(/auth: enabled/);
    expect(logger.warning).not.toHaveBeenCalled();
  });
});

describe('non-loopback binds', () => {
  it('rejects 0.0.0.0 without a token and does not listen', async () => {
    const { createServer } = makeFactory();
    await expect(startMcpHttpServer({ createServer, port: 0, host: '0.0.0.0', logger: silent })).rejects.toBeInstanceOf(HttpSecurityError);
    await expect(startMcpHttpServer({ createServer, port: 0, host: '0.0.0.0', token: '', logger: silent })).rejects.toThrow(
      'refusing to bind 0.0.0.0 without MCP_AUTH_TOKEN',
    );
  });

  it('rejects a short token and keeps it out of the message', async () => {
    const { createServer } = makeFactory();
    const error = await startMcpHttpServer({ createServer, port: 0, token: 'short-token', logger: silent }).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(HttpSecurityError);
    expect((error as Error).message).not.toContain('short-token');
  });

  it('starts on 0.0.0.0 with a token, enforces it and honours allowedHosts', async () => {
    const server = await start({ host: '0.0.0.0', token: TOKEN, allowedHosts: ['localhost', '127.0.0.1'] });
    expect(server.host).toBe('0.0.0.0');
    const headers = { Authorization: `Bearer ${TOKEN}` };
    expect(await rawStatus(server.port, {})).toBe(401);
    expect(await rawStatus(server.port, { ...headers, Host: 'evil.example' })).toBe(403);
    expect(await rawStatus(server.port, headers)).toBe(400);
  });
});

describe('sessions', () => {
  it('creates one McpServer per session and keeps their tools apart', async () => {
    const { servers, createServer } = makeFactory();
    const server = await start({ createServer });
    const a = await initializeSession(server.url);
    const b = await initializeSession(server.url);
    expect(servers).toHaveLength(2);
    expect(a.sessionId).not.toBe(b.sessionId);
    const resultA = await callWhoAmI(server.url, a.sessionId ?? '');
    const resultB = await callWhoAmI(server.url, b.sessionId ?? '');
    expect(JSON.stringify(resultA.message)).toContain('server-0');
    expect(JSON.stringify(resultB.message)).toContain('server-1');
  });

  it('delivers server-initiated notifications only to the owning session', async () => {
    const { createServer } = makeFactory();
    const bySession = new Map<string, McpServer>();
    const server = await start({
      createServer,
      onSessionCreated: (info: SessionInfo) => { bySession.set(info.sessionId, info.server); },
    });
    const a = await initializeSession(server.url);
    const b = await initializeSession(server.url);
    const streamA = await openEventStream(server.url, a.sessionId ?? '');
    const streamB = await openEventStream(server.url, b.sessionId ?? '');
    expect(streamA.status).toBe(200);
    expect(streamB.status).toBe(200);

    await bySession.get(a.sessionId ?? '')?.sendLoggingMessage({ level: 'info', data: 'only-for-A' });

    const eventA = await streamA.next();
    expect(eventA?.data).toContain('only-for-A');
    const seenByB = await streamB.collect(300);
    expect(JSON.stringify(seenByB)).not.toContain('only-for-A');
    streamA.close();
    streamB.close();
  });

  it('invokes onSessionCreated once per session with the session id, server and transport', async () => {
    const { createServer } = makeFactory();
    const onSessionCreated = vi.fn();
    const server = await start({ createServer, onSessionCreated });
    const a = await initializeSession(server.url);
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    const info = onSessionCreated.mock.calls[0]?.[0] as SessionInfo;
    expect(info.sessionId).toBe(a.sessionId);
    expect(info.server).toBeInstanceOf(McpServer);
    expect(info.transport).toBe(server.sessions.get(info.sessionId));
  });

  it('keeps serving when onSessionCreated throws, and logs it', async () => {
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const server = await start({ logger, onSessionCreated: () => { throw new Error('hook boom'); } });
    const init = await initializeSession(server.url);
    expect(init.status).toBe(200);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('hook boom');
  });

  it('removes the session and closes its server on DELETE', async () => {
    const { servers, createServer } = makeFactory();
    const server = await start({ createServer });
    const a = await initializeSession(server.url);
    const b = await initializeSession(server.url);
    expect(servers[0]?.isConnected()).toBe(true);
    const res = await fetch(server.url, { method: 'DELETE', headers: { [SESSION_HEADER]: a.sessionId ?? '' } });
    expect(res.status).toBe(200);
    expect(server.sessions.has(a.sessionId ?? '')).toBe(false);
    expect(server.sessions.has(b.sessionId ?? '')).toBe(true);
    await vi.waitFor(() => { expect(servers[0]?.isConnected()).toBe(false); });
    expect(servers[1]?.isConnected()).toBe(true);
  });

  it('answers 404 for an unknown session id (so clients re-initialise) and 400 for a missing one', async () => {
    const server = await start();
    const unknown = { [SESSION_HEADER]: 'does-not-exist' };
    const post = await postJsonRpc(server.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: unknown });
    expect(post.status).toBe(404);
    expect(post.message).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 } });
    expect((await fetch(server.url, { headers: unknown })).status).toBe(404);
    expect((await fetch(server.url, { method: 'DELETE', headers: unknown })).status).toBe(404);
    expect((await fetch(server.url)).status).toBe(400);
    expect((await fetch(server.url, { method: 'DELETE' })).status).toBe(400);
  });

  it('does not keep a session for a POST that is not an initialize request', async () => {
    const { servers, createServer } = makeFactory();
    const server = await start({ createServer });
    const res = await postJsonRpc(server.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(server.sessions.size).toBe(0);
    await vi.waitFor(() => { expect(servers.every((s) => !s.isConnected())).toBe(true); });
  });

  it('answers 500 and logs when the server factory throws, without leaking details', async () => {
    const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const server = await start({
      logger,
      token: TOKEN,
      createServer: () => { throw new Error('factory exploded'); },
    });
    const res = await postJsonRpc(
      server.url,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } },
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('factory exploded');
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('factory exploded');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(TOKEN);
  });
});

describe('event stream helper', () => {
  it('times out on an idle stream and returns null once it has ended', async () => {
    const server = await start();
    const a = await initializeSession(server.url);
    const stream = await openEventStream(server.url, a.sessionId ?? '');
    await expect(stream.next(100)).rejects.toThrow(/no SSE event within 100ms/);
    stream.close();
    await stream.ended;
    expect(await stream.next(100)).toBeNull();
  });
});

describe('close and listen errors', () => {
  it('terminates open SSE streams, releases the port and resolves', async () => {
    const { createServer } = makeFactory();
    const server = await startTestServer({ createServer });
    const a = await initializeSession(server.url);
    const stream = await openEventStream(server.url, a.sessionId ?? '');
    expect(stream.status).toBe(200);

    await server.close();
    await expect(Promise.race([
      stream.ended,
      new Promise((_, reject) => setTimeout(() => { reject(new Error('stream still open')); }, 3000)),
    ])).resolves.toBeUndefined();
    expect(server.sessions.size).toBe(0);

    const again = await startMcpHttpServer({ createServer, port: server.port, logger: silent });
    running.push(again);
    expect(again.port).toBe(server.port);
  });

  it('can be closed twice', async () => {
    const server = await startTestServer();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('rejects with the original EADDRINUSE error when the port is taken', async () => {
    const first = await start();
    const { createServer } = makeFactory();
    const error = await startMcpHttpServer({ createServer, port: first.port, logger: silent }).catch((e: unknown) => e as NodeJS.ErrnoException);
    expect(error).toBeInstanceOf(Error);
    expect((error as NodeJS.ErrnoException).code).toBe('EADDRINUSE');
  });
});
