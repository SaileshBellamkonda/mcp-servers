import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitWorktreeAdd } from '../../../../src/tools/worktree/git-worktree-add.js';
import { RepositoryManager } from '../../../../src/core/repository-manager.js';
import { PathValidator } from '../../../../src/core/path-validator.js';
import { GitExecutor } from '../../../../src/core/git-executor.js';
import { OutputParser } from '../../../../src/core/output-parser.js';
import type { Services } from '../../../../src/core/types.js';

describe('git_worktree_add tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
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
    expect(Array.from((server as any)._tools.keys())).toContain('git_worktree_add');
  });

  it('should validate path parameter', async () => {
    const handler = (server as any)._tools.get('git_worktree_add').handler;
    await expect(handler({ repository: '/repo', path: '../outside' })).rejects.toThrow();
  });
});
