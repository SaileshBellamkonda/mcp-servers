import { describe, it, expect, afterEach, vi } from 'vitest';
import { initializeSession, postJsonRpc } from '@mcp-servers/http-host/testing';
import { activateGitServer, deactivateGitServer, type GitServerInstance } from '../../../src/embedded.ts';
import { TestRepository } from '../../fixtures/test-repo.ts';

const TOKEN = `embedded-token-${'y'.repeat(32)}`;
const silent = { info: () => undefined, warning: () => undefined, error: () => undefined };

function urlOf(instance: GitServerInstance): string {
  return `http://${instance.host}:${String(instance.port)}/mcp`;
}

async function callWorkspaces(url: string, sessionId: string): Promise<string[]> {
  const reply = await postJsonRpc(
    url,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'git_workspaces', arguments: {} } },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sessionId } },
  );
  const result = (reply.message as { result: { content: { text: string }[] } }).result;
  const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { repositories: { path: string }[] };
  return parsed.repositories.map((r) => r.path);
}

describe('activateGitServer', () => {
  const repos: TestRepository[] = [];
  let instance: GitServerInstance | undefined;

  afterEach(async () => {
    if (instance) await deactivateGitServer(instance);
    instance = undefined;
    await Promise.all(repos.splice(0).map((r) => r.cleanup()));
  });

  async function newRepo(): Promise<TestRepository> {
    const repo = await TestRepository.create();
    repos.push(repo);
    return repo;
  }

  it('rejects an empty workspace folder list', async () => {
    await expect(activateGitServer({ workspaceFolders: [], port: 0, authToken: TOKEN, logger: silent }))
      .rejects.toThrow('No workspace folders provided for Git MCP Server');
  });

  it('rejects a missing token', async () => {
    const repo = await newRepo();
    await expect(activateGitServer({ workspaceFolders: [repo.path], port: 0, logger: silent } as never))
      .rejects.toThrow(/token is required/);
  });

  it('rejects an empty token', async () => {
    const repo = await newRepo();
    await expect(activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: '', logger: silent }))
      .rejects.toThrow(/token is required/);
  });

  it('rejects a short token without echoing it', async () => {
    const repo = await newRepo();
    const attempt = activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: 'short-secret', logger: silent });
    await expect(attempt).rejects.toThrow(/at least 32/);
    await expect(attempt).rejects.not.toThrow(/short-secret/);
  });

  it('listens on 127.0.0.1 and requires the bearer token', async () => {
    const repo = await newRepo();
    instance = await activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: TOKEN, logger: silent });
    expect(instance.host).toBe('127.0.0.1');
    expect(instance.port).toBeGreaterThan(0);

    const anonymous = await initializeSession(urlOf(instance));
    expect(anonymous.status).toBe(401);

    const wrong = await initializeSession(urlOf(instance), { token: `${TOKEN}-nope` });
    expect(wrong.status).toBe(401);

    const ok = await initializeSession(urlOf(instance), { token: TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.sessionId).toBeTruthy();
  });

  it('serves concurrent sessions from separate servers over the shared repository manager', async () => {
    const first = await newRepo();
    const second = await newRepo();
    instance = await activateGitServer({ workspaceFolders: [first.path], port: 0, authToken: TOKEN, logger: silent });
    const url = urlOf(instance);

    const [a, b] = await Promise.all([
      initializeSession(url, { token: TOKEN }),
      initializeSession(url, { token: TOKEN }),
    ]);
    expect(a.sessionId).toBeTruthy();
    expect(b.sessionId).toBeTruthy();
    expect(a.sessionId).not.toBe(b.sessionId);

    const [listA, listB] = await Promise.all([
      callWorkspaces(url, a.sessionId ?? ''),
      callWorkspaces(url, b.sessionId ?? ''),
    ]);
    expect(listA).toEqual([first.path]);
    expect(listB).toEqual([first.path]);

    instance.updateAllowedRepositories([second.path]);
    expect(await callWorkspaces(url, a.sessionId ?? '')).toEqual([second.path]);
    expect(await callWorkspaces(url, b.sessionId ?? '')).toEqual([second.path]);
  });

  it('frees the port on close and deactivateGitServer delegates to close()', async () => {
    const repo = await newRepo();
    instance = await activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: TOKEN, logger: silent });
    const url = urlOf(instance);
    await deactivateGitServer(instance);
    instance = undefined;
    await expect(initializeSession(url, { token: TOKEN })).rejects.toThrow();
  });

  describe('logging', () => {
    function recordingLogger() {
      return { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    }

    async function callTool(url: string, sessionId: string, name: string, args: Record<string, unknown>): Promise<void> {
      await postJsonRpc(
        url,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
        { headers: { Authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sessionId } },
      );
    }

    it('sends what the tools log (git commands at debug level) to the host logger, never to stderr', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const repo = await newRepo();
      const logger = recordingLogger();
      instance = await activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: TOKEN, logger });
      const url = urlOf(instance);
      const { sessionId } = await initializeSession(url, { token: TOKEN });

      await callTool(url, sessionId ?? '', 'git_status', { repository: repo.path });

      expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ cmd: expect.stringContaining('git ') }));
      expect(stderr).not.toHaveBeenCalled();
    });

    it('tolerates a host logger without a debug method', async () => {
      const repo = await newRepo();
      const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
      instance = await activateGitServer({ workspaceFolders: [repo.path], port: 0, authToken: TOKEN, logger });
      const url = urlOf(instance);
      const { sessionId } = await initializeSession(url, { token: TOKEN });

      await expect(callTool(url, sessionId ?? '', 'git_status', { repository: repo.path })).resolves.toBeUndefined();
    });

    it('reports a re-scoped repository list to the host logger instead of stderr', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const first = await newRepo();
      const second = await newRepo();
      const logger = recordingLogger();
      instance = await activateGitServer({ workspaceFolders: [first.path], port: 0, authToken: TOKEN, logger });

      instance.updateAllowedRepositories([second.path]);

      expect(logger.info).toHaveBeenCalledWith(`Updated allowed repositories: ${second.path}`);
      expect(stderr).not.toHaveBeenCalled();
    });
  });
});
