import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitWorktreeAdd } from '../../../../src/tools/worktree/git-worktree-add.ts';
import { RepositoryManager } from '../../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../../src/core/git-executor.ts';
import { OutputParser } from '../../../../src/core/output-parser.ts';
import type { Services } from '../../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../../fixtures/registered-tools.ts';

describe('git_worktree_add tool', () => {
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

    registerGitWorktreeAdd(server, services);
  });

  it('should register git_worktree_add tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_worktree_add');
  });

  it('should validate path parameter', async () => {
    const tool = registeredTool(server, 'git_worktree_add');
    await expect(tool.handler({ repository: '/repo', path: '../outside' })).rejects.toThrow();
  });
});
