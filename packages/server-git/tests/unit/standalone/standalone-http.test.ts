import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';
import { TestRepository } from '../../fixtures/test-repo.js';
import {
  TOKEN,
  connectOutcome,
  externalIPv4,
  freePort,
  spawnStandalone,
  type StandaloneProcess,
} from '../../fixtures/standalone-process.js';

describe('standalone git HTTP entry point', () => {
  let repo: TestRepository;
  let proc: StandaloneProcess | undefined;

  beforeEach(async () => {
    repo = await TestRepository.create();
  });

  afterEach(async () => {
    proc?.kill();
    await proc?.exited;
    proc = undefined;
    await repo.cleanup();
  });

  it('serves authenticated MCP sessions on 127.0.0.1 and shuts down on SIGTERM', async () => {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      GIT_ALLOWED_REPOS: repo.path,
    });
    await proc.waitForStderr(/listening on http:\/\/127\.0\.0\.1:\d+\/mcp/);
    const url = `http://127.0.0.1:${String(port)}/mcp`;

    const anonymous = await initializeSession(url);
    expect(anonymous.status).toBe(401);

    const authorised = await initializeSession(url, { token: TOKEN });
    expect(authorised.status).toBe(200);
    expect(authorised.sessionId).toBeTruthy();

    // A second session works too (each gets its own server over the shared repository manager).
    const second = await initializeSession(url, { token: TOKEN });
    expect(second.status).toBe(200);
    const reply = await postJsonRpc(
      url,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'git_workspaces', arguments: {} } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': second.sessionId ?? '' } },
    );
    expect(JSON.stringify(reply.message)).toContain(repo.path);

    expect(await connectOutcome('127.0.0.1', port)).toBe('connected');
    const external = externalIPv4();
    if (external) expect(await connectOutcome(external, port)).toBe('refused');

    expect(proc.stderr()).not.toContain(TOKEN);

    proc.child.kill('SIGTERM');
    const { code } = await proc.exited;
    expect(code).toBe(0);
  }, 30000);

  it('refuses a non-loopback bind without a token and never prints a supplied token', async () => {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_HOST: '0.0.0.0',
      MCP_HTTP_PORT: String(port),
      GIT_ALLOWED_REPOS: repo.path,
    });
    const { code } = await proc.exited;
    expect(code).not.toBe(0);
    expect(proc.stderr()).toContain('MCP_AUTH_TOKEN');
  }, 30000);

  it('rejects a too-short token without echoing it', async () => {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: 'shortsecret',
      GIT_ALLOWED_REPOS: repo.path,
    });
    const { code } = await proc.exited;
    expect(code).not.toBe(0);
    expect(proc.stderr()).toContain('MCP_AUTH_TOKEN');
    expect(proc.stderr()).not.toContain('shortsecret');
  }, 30000);
});
