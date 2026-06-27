import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitReflog } from '../../../src/tools/git-reflog.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_reflog tool', () => {
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

    registerGitReflog(server, services);
  });

  it('should register git_reflog tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_reflog');
  });

  it('uses default limit of 20 when no limit given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_reflog'];
    await tool.handler({ repository: '/repo' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      'reflog',
      '--format=%H|%gd|%gs|%ci',
      '-n',
      '20',
    ]);
  });

  it('uses custom limit when limit given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_reflog'];
    await tool.handler({ repository: '/repo', limit: 5 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      'reflog',
      '--format=%H|%gd|%gs|%ci',
      '-n',
      '5',
    ]);
  });

  it('throws on limit of 0 (below min of 1)', async () => {
    const tool = (server as any)._registeredTools['git_reflog'];
    await expect(tool.handler({ repository: '/repo', limit: 0 })).rejects.toThrow();
  });

  it('throws on limit of 101 (above max of 100)', async () => {
    const tool = (server as any)._registeredTools['git_reflog'];
    await expect(tool.handler({ repository: '/repo', limit: 101 })).rejects.toThrow();
  });

  it('parses pipe-delimited reflog output correctly', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'abc123|HEAD@{0}|commit: init|2024-01-01 00:00:00 +0000\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_reflog'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.entries).toHaveLength(1);
    expect(content.entries[0]).toMatchObject({
      hash: 'abc123',
      ref: 'HEAD@{0}',
      description: 'commit: init',
      date: '2024-01-01 00:00:00 +0000',
    });
  });

  it('returns empty entries array when output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_reflog'];
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.entries).toEqual([]);
  });

  it('throws Git reflog failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'fatal: bad default revision',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_reflog'];
    await expect(tool.handler({ repository: '/repo' })).rejects.toThrow('Git reflog failed');
  });
});
