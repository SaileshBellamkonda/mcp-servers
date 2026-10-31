import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitCommit } from '../../../src/tools/git-commit.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

describe('git_commit tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };

    registerGitCommit(server, services);
  });

  afterEach(() => {
    delete process.env['GIT_COMMIT_NAME'];
    delete process.env['GIT_COMMIT_EMAIL'];
  });

  it('should register git_commit tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_commit');
  });

  it('should reject empty message', async () => {
    const tool = registeredTool(server, 'git_commit');
    await expect(tool.handler({ repository: '/repo', message: '' })).rejects.toThrow();
  });

  it('should reject message over 500 characters', async () => {
    const tool = registeredTool(server, 'git_commit');
    const longMessage = 'a'.repeat(501);
    await expect(tool.handler({ repository: '/repo', message: longMessage })).rejects.toThrow();
  });

  it('calls executor with identity args when GIT_COMMIT_NAME and GIT_COMMIT_EMAIL are set', async () => {
    process.env['GIT_COMMIT_NAME'] = 'Bot';
    process.env['GIT_COMMIT_EMAIL'] = 'bot@example.com';

    const executeSpy = vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '[main abc1234] test commit',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_commit');
    await tool.handler({ repository: '/repo', message: 'test commit' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      '-c', 'user.name=Bot',
      '-c', 'user.email=bot@example.com',
      'commit', '-m', 'test commit',
    ]);
  });

  it('calls executor without identity args when no env vars set', async () => {
    const executeSpy = vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '[main abc1234] test commit',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_commit');
    await tool.handler({ repository: '/repo', message: 'test commit' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['commit', '-m', 'test commit']);
  });

  it('calls executor with identity args including empty email when only name set', async () => {
    process.env['GIT_COMMIT_NAME'] = 'Bot';

    const executeSpy = vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '[main abc1234] test commit',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_commit');
    await tool.handler({ repository: '/repo', message: 'test commit' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      '-c', 'user.name=Bot',
      '-c', 'user.email=',
      'commit', '-m', 'test commit',
    ]);
  });
});
