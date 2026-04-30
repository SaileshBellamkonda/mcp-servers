import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitWorktreeRemove } from '../../../../src/tools/worktree/git-worktree-remove.js';
import { RepositoryManager } from '../../../../src/core/repository-manager.js';
import { PathValidator } from '../../../../src/core/path-validator.js';
import { GitExecutor } from '../../../../src/core/git-executor.js';
import { OutputParser } from '../../../../src/core/output-parser.js';
import type { Services } from '../../../../src/core/types.js';

describe('git_worktree_remove tool', () => {
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
    registerGitWorktreeRemove(server, services);
  });

  it('should register git_worktree_remove tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_worktree_remove');
  });
});
