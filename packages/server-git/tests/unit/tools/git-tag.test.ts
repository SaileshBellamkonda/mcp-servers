import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitTag } from '../../../src/tools/git-tag.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.js';

describe('git_tag tool', () => {
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

    registerGitTag(server, services);
  });

  it('should register git_tag tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_tag');
  });

  it('calls tag --sort=-version:refname for list action', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: 'v1.2.0\nv1.1.0\nv1.0.0\n', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_tag');
    const result = await tool.handler({ repository: '/repo', action: 'list' });
    const content = JSON.parse(result.content[0].text);

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['tag', '--sort=-version:refname']);
    expect(content.success).toBe(true);
    expect(content.tags).toEqual(['v1.2.0', 'v1.1.0', 'v1.0.0']);
  });

  it('returns empty tags array when list output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_tag');
    const result = await tool.handler({ repository: '/repo', action: 'list' });
    const content = JSON.parse(result.content[0].text);

    expect(content.tags).toEqual([]);
  });

  it('calls lightweight tag create', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_tag');
    await tool.handler({ repository: '/repo', action: 'create', name: 'v1.0.0' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['tag', 'v1.0.0']);
  });

  it('calls annotated tag create with -a and -m flags', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_tag');
    await tool.handler({ repository: '/repo', action: 'create', name: 'v1.0.0', message: 'Release 1.0.0' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
  });

  it('appends ref to create args when ref given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_tag');
    await tool.handler({ repository: '/repo', action: 'create', name: 'v1.0.0', ref: 'abc1234' });

    const calledArgs = executeSpy.mock.calls[0]![1];
    expect(calledArgs[calledArgs.length - 1]).toBe('abc1234');
  });

  it('calls tag -d for delete action', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_tag');
    await tool.handler({ repository: '/repo', action: 'delete', name: 'v1.0.0' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['tag', '-d', 'v1.0.0']);
  });

  it('throws when create action has no name', async () => {
    const tool = registeredTool(server, 'git_tag');
    await expect(
      tool.handler({ repository: '/repo', action: 'create' }),
    ).rejects.toThrow('"name" is required for action "create"');
  });

  it('throws when delete action has no name', async () => {
    const tool = registeredTool(server, 'git_tag');
    await expect(
      tool.handler({ repository: '/repo', action: 'delete' }),
    ).rejects.toThrow('"name" is required for action "delete"');
  });

  it('throws on git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'tag already exists',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_tag');
    await expect(
      tool.handler({ repository: '/repo', action: 'create', name: 'v1.0.0' }),
    ).rejects.toThrow('Git tag failed');
  });
});
