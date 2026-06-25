import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitWorktreeLock } from '../../../../src/tools/worktree/git-worktree-lock.js';
import { RepositoryManager } from '../../../../src/core/repository-manager.js';
import { PathValidator } from '../../../../src/core/path-validator.js';
import { GitExecutor } from '../../../../src/core/git-executor.js';
import { OutputParser } from '../../../../src/core/output-parser.js';
import type { Services } from '../../../../src/core/types.js';

describe('git_worktree_lock tool', () => {
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

    registerGitWorktreeLock(server, services);
  });

  it('should register git_worktree_lock tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_worktree_lock');
  });
});
