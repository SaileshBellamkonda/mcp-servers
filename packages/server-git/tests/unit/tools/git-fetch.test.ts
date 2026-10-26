import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitFetch } from '../../../src/tools/git-fetch.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_fetch tool', () => {
  // The argument-shape tests below use mocked executors with no configured remotes, so they run in the
  // documented opt-in mode (GIT_ALLOW_REMOTE_URLS=1); the default mode has its own tests at the end.
  beforeEach(() => {
    process.env['GIT_ALLOW_REMOTE_URLS'] = '1';
  });
  afterEach(() => {
    delete process.env['GIT_ALLOW_REMOTE_URLS'];
  });

  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser(),
    };

    registerGitFetch(server, services);
  });

  it('should register git_fetch tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_fetch');
  });

  it('calls fetch with default remote when no branch given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_fetch'];
    await tool.handler({ repository: '/repo' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['fetch', 'origin']);
  });

  it('calls fetch with remote and branch when branch given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_fetch'];
    await tool.handler({ repository: '/repo', branch: 'main' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['fetch', 'origin', 'main']);
  });

  it('calls fetch with custom remote', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_fetch'];
    await tool.handler({ repository: '/repo', remote: 'upstream' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['fetch', 'upstream']);
  });

  it('throws Git fetch failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'no such remote',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_fetch'];
    await expect(tool.handler({ repository: '/repo' })).rejects.toThrow('Git fetch failed: no such remote');
  });

  it('returns success with remote and output', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'From origin\n * branch main -> FETCH_HEAD',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_fetch'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.remote).toBe('origin');
    expect(content.output).toContain('From origin');
  });

  it('returns branch in response when branch given', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_fetch'];
    const result = await tool.handler({ repository: '/repo', branch: 'feature' });
    const content = JSON.parse(result.content[0].text);

    expect(content.branch).toBe('feature');
  });

  it('throws for invalid repository', async () => {
    const tool = (server as any)._registeredTools['git_fetch'];
    await expect(tool.handler({ repository: '/invalid' })).rejects.toThrow();
  });

  describe('remote must be a configured remote name (default mode)', () => {
    beforeEach(() => {
      delete process.env['GIT_ALLOW_REMOTE_URLS'];
    });

    const mockGit = () =>
      vi.spyOn(services.gitExecutor, 'execute').mockImplementation(async (_repo, args) => ({
        stdout: args[0] === 'remote' ? 'origin\nupstream\n' : '',
        stderr: '',
        exitCode: 0,
        success: true,
      }));

    it('runs fetch against a configured remote', async () => {
      const executeSpy = mockGit();
      const tool = (server as any)._registeredTools['git_fetch'];
      await tool.handler({ repository: '/repo', remote: 'upstream' });
      expect(executeSpy).toHaveBeenCalledWith('/repo', ['remote']);
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'fetch' && c[1].includes('upstream'))).toBe(true);
    });

    it.each(['https://evil.example/r.git', '/srv/git/r.git', 'ext::sh -c id', 'not-configured'])(
      'refuses %s without running fetch',
      async (remote) => {
        const executeSpy = mockGit();
        const tool = (server as any)._registeredTools['git_fetch'];
        await expect(tool.handler({ repository: '/repo', remote })).rejects.toThrow(/configured remote/);
        expect(executeSpy.mock.calls.some((c) => c[1][0] === 'fetch')).toBe(false);
      },
    );

    it('refuses option-like remote and branch values', async () => {
      const executeSpy = mockGit();
      const tool = (server as any)._registeredTools['git_fetch'];
      await expect(tool.handler({ repository: '/repo', remote: '--upload-pack=touch /tmp/x', branch: 'main' })).rejects.toThrow(/must not start with/);
      await expect(tool.handler({ repository: '/repo', remote: 'origin', branch: '--upload-pack=touch /tmp/x' })).rejects.toThrow(/Invalid branch/);
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'fetch')).toBe(false);
    });

    it('allows URLs when GIT_ALLOW_REMOTE_URLS=1 but still refuses ext:: helpers', async () => {
      process.env['GIT_ALLOW_REMOTE_URLS'] = '1';
      const executeSpy = mockGit();
      const tool = (server as any)._registeredTools['git_fetch'];
      await tool.handler({ repository: '/repo', remote: 'https://example.com/r.git' });
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'fetch' && c[1].includes('https://example.com/r.git'))).toBe(true);
      await expect(tool.handler({ repository: '/repo', remote: 'ext::sh -c id' })).rejects.toThrow(/helper/);
    });
  });
});
