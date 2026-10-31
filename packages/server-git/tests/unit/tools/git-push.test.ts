import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitPush } from '../../../src/tools/git-push.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

describe('git_push tool', () => {
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

    registerGitPush(server, services);
  });

  afterEach(() => {
    delete process.env['GIT_PUSH_ALLOWED_BRANCHES'];
  });

  it('should register git_push tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_push');
  });

  it('calls push with explicit branch (no rev-parse)', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_push');
    await tool.handler({ repository: '/repo', branch: 'feature' });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith('/repo', ['push', 'origin', 'feature']);
  });

  it('auto-resolves current branch via rev-parse when no branch given', async () => {
    const executeSpy = vi.spyOn(services.gitExecutor, 'execute');
    executeSpy
      .mockResolvedValueOnce({ stdout: 'main\n', stderr: '', exitCode: 0, success: true })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_push');
    await tool.handler({ repository: '/repo' });

    expect(executeSpy).toHaveBeenNthCalledWith(1, '/repo', ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(executeSpy).toHaveBeenNthCalledWith(2, '/repo', ['push', 'origin', 'main']);
  });

  it('includes --force when force is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_push');
    await tool.handler({ repository: '/repo', branch: 'feature', force: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['push', '--force', 'origin', 'feature']);
  });

  it('allows push when branch is in allowlist', async () => {
    process.env['GIT_PUSH_ALLOWED_BRANCHES'] = 'main;develop';
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_push');
    await expect(tool.handler({ repository: '/repo', branch: 'main' })).resolves.not.toThrow();
  });

  it('blocks push when branch is not in allowlist', async () => {
    process.env['GIT_PUSH_ALLOWED_BRANCHES'] = 'main';

    const tool = registeredTool(server, 'git_push');
    await expect(tool.handler({ repository: '/repo', branch: 'feature' })).rejects.toThrow(
      'not in the allowed list',
    );
  });

  it('allows any branch when allowlist is wildcard *', async () => {
    process.env['GIT_PUSH_ALLOWED_BRANCHES'] = '*';
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_push');
    await expect(tool.handler({ repository: '/repo', branch: 'anything' })).resolves.not.toThrow();
  });

  it('throws Git push failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'rejected by remote',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_push');
    await expect(tool.handler({ repository: '/repo', branch: 'main' })).rejects.toThrow(
      'Git push failed',
    );
  });

  it('throws unable to determine current branch when rev-parse fails', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128,
      success: false,
    });

    const tool = registeredTool(server, 'git_push');
    await expect(tool.handler({ repository: '/repo' })).rejects.toThrow(
      'unable to determine current branch',
    );
  });

  it('returns success with branch and force in response', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'To origin\n   abc..def  feature -> feature',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_push');
    const result = await tool.handler({ repository: '/repo', branch: 'feature', force: false });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.branch).toBe('feature');
    expect(content.force).toBe(false);
    expect(content.remote).toBe('origin');
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

    it('runs push against a configured remote', async () => {
      const executeSpy = mockGit();
      const tool = registeredTool(server, 'git_push');
      await tool.handler({ repository: '/repo', remote: 'upstream', branch: 'main' });
      expect(executeSpy).toHaveBeenCalledWith('/repo', ['remote']);
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'push' && c[1].includes('upstream'))).toBe(true);
    });

    it.each(['https://evil.example/r.git', '/srv/git/r.git', 'ext::sh -c id', 'not-configured'])(
      'refuses %s without running push',
      async (remote) => {
        const executeSpy = mockGit();
        const tool = registeredTool(server, 'git_push');
        await expect(tool.handler({ repository: '/repo', remote, branch: 'main' })).rejects.toThrow(/configured remote/);
        expect(executeSpy.mock.calls.some((c) => c[1][0] === 'push')).toBe(false);
      },
    );

    it('refuses option-like remote and branch values', async () => {
      const executeSpy = mockGit();
      const tool = registeredTool(server, 'git_push');
      await expect(tool.handler({ repository: '/repo', remote: '--upload-pack=touch /tmp/x', branch: 'main' })).rejects.toThrow(/must not start with/);
      await expect(tool.handler({ repository: '/repo', remote: 'origin', branch: '--upload-pack=touch /tmp/x' })).rejects.toThrow(/Invalid branch/);
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'push')).toBe(false);
    });

    it('allows URLs when GIT_ALLOW_REMOTE_URLS=1 but still refuses ext:: helpers', async () => {
      process.env['GIT_ALLOW_REMOTE_URLS'] = '1';
      const executeSpy = mockGit();
      const tool = registeredTool(server, 'git_push');
      await tool.handler({ repository: '/repo', remote: 'https://example.com/r.git', branch: 'main' });
      expect(executeSpy.mock.calls.some((c) => c[1][0] === 'push' && c[1].includes('https://example.com/r.git'))).toBe(true);
      await expect(tool.handler({ repository: '/repo', remote: 'ext::sh -c id', branch: 'main' })).rejects.toThrow(/helper/);
    });
  });
});
