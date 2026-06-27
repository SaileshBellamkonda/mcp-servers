import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitPull } from '../../../src/tools/git-pull.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_pull tool', () => {
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

    registerGitPull(server, services);
  });

  it('should register git_pull tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_pull');
  });

  it('calls pull with default remote and no rebase when no options given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: 'Already up to date.', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_pull'];
    await tool.handler({ repository: '/repo' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['pull', 'origin']);
  });

  it('calls pull with --rebase when rebase is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_pull'];
    await tool.handler({ repository: '/repo', rebase: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['pull', '--rebase', 'origin']);
  });

  it('calls pull with branch appended when branch given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_pull'];
    await tool.handler({ repository: '/repo', branch: 'feature' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['pull', 'origin', 'feature']);
  });

  it('returns conflict response when CONFLICT in stdout', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'CONFLICT (content): Merge conflict in file.ts\nAutomatic merge failed.',
      stderr: '',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_pull'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(false);
    expect(Array.isArray(content.conflicts)).toBe(true);
    expect(content.conflicts).toContain('CONFLICT (content): Merge conflict in file.ts');
    expect(content.message).toContain('conflict');
  });

  it('returns conflict response when lowercase conflict in stderr with no success', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'there is a conflict during pull',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_pull'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(false);
    // conflicts array filters for uppercase CONFLICT, so empty here
    expect(content.conflicts).toEqual([]);
  });

  it('throws on non-conflict git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'network error',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_pull'];
    await expect(tool.handler({ repository: '/repo' })).rejects.toThrow('Git pull failed');
  });

  it('returns success with rebase: false on success', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'Already up to date.',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_pull'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.rebase).toBe(false);
    expect(content.remote).toBe('origin');
  });
});
