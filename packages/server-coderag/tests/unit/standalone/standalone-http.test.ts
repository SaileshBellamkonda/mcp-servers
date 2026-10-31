import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';
import {
  TOKEN,
  connectOutcome,
  externalIPv4,
  freePort,
  spawnStandalone,
  type StandaloneProcess,
} from '../../fixtures/standalone-process.ts';

describe('standalone coderag HTTP entry point', () => {
  let dir: string;
  let proc: StandaloneProcess | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-standalone-'));
  });

  afterEach(async () => {
    proc?.kill();
    await proc?.exited;
    proc = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const env = (extra: Record<string, string>): Record<string, string> => ({
    MCP_TRANSPORT: 'http',
    CODERAG_EMBEDDING_URL: 'http://127.0.0.1:9/v1',
    CODERAG_EMBEDDING_MODEL: 'smoke-model',
    CODERAG_EMBEDDING_DIM: '4',
    CODERAG_DB_PATH: path.join(dir, 'index.db'),
    CODERAG_DOCS_INCLUDE: path.join(dir, 'docs', '**', '*.md'),
    CODERAG_CODE_INCLUDE: path.join(dir, 'src', '**', '*.ts'),
    ...extra,
  });

  it('serves authenticated MCP sessions on 127.0.0.1 and shuts down on SIGTERM', async () => {
    const port = await freePort();
    proc = spawnStandalone(env({ MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: TOKEN }));
    await proc.waitForStderr(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
    const url = `http://127.0.0.1:${String(port)}/mcp`;

    expect((await initializeSession(url)).status).toBe(401);

    const first = await initializeSession(url, { token: TOKEN });
    const second = await initializeSession(url, { token: TOKEN });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    for (const session of [first, second]) {
      const reply = await postJsonRpc(
        url,
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_index_status', arguments: {} } },
        { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': session.sessionId ?? '' } },
      );
      expect(JSON.stringify(reply.message)).toContain('smoke-model');
    }

    expect(await connectOutcome('127.0.0.1', port)).toBe('connected');
    const external = externalIPv4();
    if (external) expect(await connectOutcome(external, port)).toBe('refused');

    expect(proc.stderr()).not.toContain(TOKEN);

    proc.child.kill('SIGTERM');
    const { code } = await proc.exited;
    expect(code).toBe(0);
  }, 60000);

  it('refuses a non-loopback bind without a token', async () => {
    const port = await freePort();
    proc = spawnStandalone(env({ MCP_HTTP_HOST: '0.0.0.0', MCP_HTTP_PORT: String(port) }));
    const { code } = await proc.exited;
    expect(code).not.toBe(0);
    expect(proc.stderr()).toContain('MCP_AUTH_TOKEN');
  }, 30000);

  it('rejects a too-short token without echoing it', async () => {
    const port = await freePort();
    proc = spawnStandalone(env({ MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: 'shortsecret' }));
    const { code } = await proc.exited;
    expect(code).not.toBe(0);
    expect(proc.stderr()).toContain('MCP_AUTH_TOKEN');
    expect(proc.stderr()).not.toContain('shortsecret');
  }, 30000);
});
