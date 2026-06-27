import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitShow } from '../../../src/tools/git-show.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_show tool', () => {
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

    registerGitShow(server, services);
  });

  it('should register git_show tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_show');
  });

  it('calls show with a valid commit hash', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: 'commit abc1234\n...', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_show'];
    await tool.handler({ repository: '/repo', commit: 'abc1234' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['show', 'abc1234']);
  });

  it('accepts HEAD as valid ref', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: 'commit abc\n', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_show'];
    await tool.handler({ repository: '/repo', commit: 'HEAD' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['show', 'HEAD']);
  });

  it('accepts main as valid ref', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_show'];
    await tool.handler({ repository: '/repo', commit: 'main' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['show', 'main']);
  });

  it('accepts origin/main as valid ref', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_show'];
    await tool.handler({ repository: '/repo', commit: 'origin/main' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['show', 'origin/main']);
  });

  it('accepts HEAD~2 as valid ref', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_show'];
    await tool.handler({ repository: '/repo', commit: 'HEAD~2' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['show', 'HEAD~2']);
  });

  it('throws Invalid commit ref for ref with $ character', async () => {
    const tool = (server as any)._registeredTools['git_show'];
    await expect(
      tool.handler({ repository: '/repo', commit: '$bad' }),
    ).rejects.toThrow('Invalid commit ref: $bad');
  });

  it('throws Invalid commit ref for ref with space', async () => {
    const tool = (server as any)._registeredTools['git_show'];
    await expect(
      tool.handler({ repository: '/repo', commit: 'bad ref' }),
    ).rejects.toThrow('Invalid commit ref');
  });

  it('throws Invalid commit ref for ref with semicolon', async () => {
    const tool = (server as any)._registeredTools['git_show'];
    await expect(
      tool.handler({ repository: '/repo', commit: 'main;ls' }),
    ).rejects.toThrow('Invalid commit ref');
  });

  it('throws Git show failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'unknown revision',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_show'];
    await expect(
      tool.handler({ repository: '/repo', commit: 'abc1234' }),
    ).rejects.toThrow('Git show failed');
  });

  it('returns commit and output in success response', async () => {
    const diffOutput = 'commit abc1234\nAuthor: Test\n\ndiff --git a/foo.ts b/foo.ts';
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: diffOutput,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_show'];
    const result = await tool.handler({ repository: '/repo', commit: 'abc1234' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.commit).toBe('abc1234');
    expect(content.output).toBe(diffOutput);
  });
});
