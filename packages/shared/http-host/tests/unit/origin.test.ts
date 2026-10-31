import { afterEach, describe, expect, it } from 'vitest';
import { type McpHttpServer } from '../../src/index.ts';
import { initializeSession, startTestServer } from '../../src/testing/index.ts';
import { INIT_BODY, JSON_HEADERS, makeCountingFactory, rawRequest } from './support.ts';

const TOKEN = `tok-${'x'.repeat(40)}`;
const running: McpHttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

async function start(options: Parameters<typeof startTestServer>[0] = {}): Promise<Awaited<ReturnType<typeof startTestServer>>> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

describe('Origin validation', () => {
  it('rejects a foreign Origin on POST with 403 before any server or session is created', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer });
    const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, Origin: 'http://evil.example' }, body: INIT_BODY });
    expect(res.status).toBe(403);
    expect(servers).toHaveLength(0);
    expect(server.sessions.size).toBe(0);
  });

  it('blocks the CORS-safelisted text/plain forgery from a foreign Origin', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer });
    const res = await rawRequest({
      port: server.port,
      headers: { 'Content-Type': 'text/plain;x=application/json', Accept: 'application/json, text/event-stream', Origin: 'http://evil.example' },
      body: INIT_BODY,
    });
    expect(res.status).toBe(403);
    expect(servers).toHaveLength(0);
  });

  it('rejects a foreign Origin on GET and DELETE', async () => {
    const server = await start();
    const init = await initializeSession(server.url);
    const headers = { Origin: 'http://evil.example', 'mcp-session-id': init.sessionId ?? '', Accept: 'text/event-stream' };
    expect((await rawRequest({ port: server.port, method: 'GET', headers })).status).toBe(403);
    expect((await rawRequest({ port: server.port, method: 'DELETE', headers })).status).toBe(403);
    expect(server.sessions.has(init.sessionId ?? '')).toBe(true);
  });

  it.each([
    'http://localhost:1234',
    'http://localhost',
    'https://LOCALHOST:8443',
    'http://127.0.0.1',
    'http://127.0.0.1:9999',
    'http://127.0.0.2:3',
    'http://[::1]:5',
    'http://[::1]',
  ])('allows the loopback Origin %s', async (origin) => {
    const server = await start();
    const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, Origin: origin }, body: INIT_BODY });
    expect(res.status).toBe(200);
  });

  it('allows requests without an Origin header', async () => {
    const server = await start();
    expect((await initializeSession(server.url)).status).toBe(200);
  });

  it.each([
    'null',
    '',
    'http://evil.example',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
    'http://evil.example/http://localhost',
    'http://localhost@evil.example',
    'not a url',
    'file://',
  ])('rejects the Origin [%s]', async (origin) => {
    const server = await start();
    const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, Origin: origin }, body: INIT_BODY });
    expect(res.status).toBe(403);
    expect(server.sessions.size).toBe(0);
  });

  it('honours allowedOrigins by origin or by host name, case-insensitively', async () => {
    const server = await start({ allowedOrigins: ['https://app.example', 'Tools.Example'] });
    const post = (origin: string): Promise<{ status: number }> => rawRequest({ port: server.port, headers: { ...JSON_HEADERS, Origin: origin }, body: INIT_BODY });
    expect((await post('https://app.example')).status).toBe(200);
    expect((await post('https://APP.example')).status).toBe(200);
    expect((await post('https://tools.example:4000')).status).toBe(200);
    expect((await post('http://app.example')).status).toBe(403);
    expect((await post('https://other.example')).status).toBe(403);
  });

  it('applies in token mode too, ahead of nothing but the check itself, and still lets token clients without Origin in', async () => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer, token: TOKEN });
    const withToken = { ...JSON_HEADERS, Authorization: `Bearer ${TOKEN}` };
    expect((await rawRequest({ port: server.port, headers: { ...withToken, Origin: 'http://evil.example' }, body: INIT_BODY })).status).toBe(403);
    expect(servers).toHaveLength(0);
    expect((await rawRequest({ port: server.port, headers: withToken, body: INIT_BODY })).status).toBe(200);
    expect((await rawRequest({ port: server.port, headers: { ...withToken, Origin: 'http://localhost:3000' }, body: INIT_BODY })).status).toBe(200);
  });
});

describe('POST Content-Type', () => {
  it.each([
    'text/plain',
    'text/plain;x=application/json',
    'text/plain; charset=application/json',
    'application/x-www-form-urlencoded',
    'application/jsonx',
    'application/vnd.api+json',
    'multipart/form-data; boundary=application/json',
    '',
  ])('answers 415 for [%s] without creating a server', async (contentType) => {
    const { servers, createServer } = makeCountingFactory();
    const server = await start({ createServer });
    const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' };
    if (contentType) headers['Content-Type'] = contentType;
    const res = await rawRequest({ port: server.port, headers, body: INIT_BODY });
    expect(res.status).toBe(415);
    expect(servers).toHaveLength(0);
    expect(server.sessions.size).toBe(0);
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8', ' application/json ;x=1'])(
    'accepts [%s]',
    async (contentType) => {
      const server = await start();
      const res = await rawRequest({ port: server.port, headers: { ...JSON_HEADERS, 'Content-Type': contentType }, body: INIT_BODY });
      expect(res.status).toBe(200);
    },
  );

  it('answers 401 before 415 when a token is required', async () => {
    const server = await start({ token: TOKEN });
    const res = await rawRequest({ port: server.port, headers: { 'Content-Type': 'text/plain', Accept: 'application/json, text/event-stream' }, body: INIT_BODY });
    expect(res.status).toBe(401);
  });
});
