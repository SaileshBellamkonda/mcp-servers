import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitStash } from '../../../src/tools/git-stash.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.js';

describe('git_stash tool', () => {
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

    registerGitStash(server, services);
  });

  it('should register git_stash tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_stash');
  });

  it('calls stash push without message', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: 'Saved working directory', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_stash');
    await tool.handler({ repository: '/repo', action: 'push' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'push']);
  });

  it('calls stash push with -m message when message given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_stash');
    await tool.handler({ repository: '/repo', action: 'push', message: 'my work' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'push', '-m', 'my work']);
  });

  it('calls stash pop with stash@{0} when index is 0', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_stash');
    await tool.handler({ repository: '/repo', action: 'pop', index: 0 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'pop', 'stash@{0}']);
  });

  it('calls stash pop with stash@{2} when index is 2', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_stash');
    await tool.handler({ repository: '/repo', action: 'pop', index: 2 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'pop', 'stash@{2}']);
  });

  it('calls stash list and returns stashes array', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({
        stdout: 'stash@{0}: WIP on main: abc1234 my message\n',
        stderr: '',
        exitCode: 0,
        success: true,
      });

    const tool = registeredTool(server, 'git_stash');
    const result = await tool.handler({ repository: '/repo', action: 'list' });
    const content = JSON.parse(result.content[0].text);

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'list']);
    expect(content.success).toBe(true);
    expect(Array.isArray(content.stashes)).toBe(true);
  });

  it('parses stash list entries correctly', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'stash@{0}: WIP on main: abc1234 my message\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_stash');
    const result = await tool.handler({ repository: '/repo', action: 'list' });
    const content = JSON.parse(result.content[0].text);

    expect(content.stashes).toHaveLength(1);
    expect(content.stashes[0]).toMatchObject({
      index: 0,
      branch: 'main',
      hash: 'abc1234',
      message: 'my message',
    });
  });

  it('returns empty stashes array when list output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_stash');
    const result = await tool.handler({ repository: '/repo', action: 'list' });
    const content = JSON.parse(result.content[0].text);

    expect(content.stashes).toEqual([]);
  });

  it('calls stash drop with stash@{0}', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_stash');
    await tool.handler({ repository: '/repo', action: 'drop', index: 0 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['stash', 'drop', 'stash@{0}']);
  });

  it('throws on git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'No stash entries found.',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_stash');
    await expect(tool.handler({ repository: '/repo', action: 'pop' })).rejects.toThrow('Git stash failed');
  });
});
