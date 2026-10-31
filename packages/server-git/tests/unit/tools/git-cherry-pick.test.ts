import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitCherryPick } from '../../../src/tools/git-cherry-pick.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.js';

describe('git_cherry_pick tool', () => {
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

    registerGitCherryPick(server, services);
  });

  it('should register git_cherry_pick tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_cherry_pick');
  });

  it('calls cherry-pick with single commit', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_cherry_pick');
    await tool.handler({ repository: '/repo', commits: ['abc123'] });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['cherry-pick', 'abc123']);
  });

  it('calls cherry-pick with multiple commits', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_cherry_pick');
    await tool.handler({ repository: '/repo', commits: ['abc123', 'def456'] });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['cherry-pick', 'abc123', 'def456']);
  });

  it('calls cherry-pick with --no-commit when no_commit is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_cherry_pick');
    await tool.handler({ repository: '/repo', commits: ['abc123'], no_commit: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['cherry-pick', '--no-commit', 'abc123']);
  });

  it('throws when commits array is empty (Zod min 1 validation)', async () => {
    const tool = registeredTool(server, 'git_cherry_pick');
    await expect(tool.handler({ repository: '/repo', commits: [] })).rejects.toThrow();
  });

  it('returns conflict response when exitCode != 0 and CONFLICT in output', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'CONFLICT (content): Merge conflict in file.ts',
      stderr: '',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_cherry_pick');
    const result = await tool.handler({ repository: '/repo', commits: ['abc123'] });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(false);
    expect(content.conflicts).toContain('CONFLICT (content): Merge conflict in file.ts');
  });

  it('returns success with commits and no_commit: false', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '[main abc1234] cherry picked',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_cherry_pick');
    const result = await tool.handler({ repository: '/repo', commits: ['abc123'] });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.commits).toEqual(['abc123']);
    expect(content.no_commit).toBe(false);
  });

  it('throws on non-conflict git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'bad object: abc123',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_cherry_pick');
    await expect(tool.handler({ repository: '/repo', commits: ['abc123'] })).rejects.toThrow(
      'Git cherry-pick failed',
    );
  });
});
