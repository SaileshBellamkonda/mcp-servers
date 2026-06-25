import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitCommit } from '../../../src/tools/git-commit.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

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

  it('should register git_commit tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_commit');
  });

  it('should reject empty message', async () => {
    const tool = (server as any)._registeredTools['git_commit'];
    await expect(tool.handler({ repository: '/repo', message: '' })).rejects.toThrow();
  });

  it('should reject message over 500 characters', async () => {
    const tool = (server as any)._registeredTools['git_commit'];
    const longMessage = 'a'.repeat(501);
    await expect(tool.handler({ repository: '/repo', message: longMessage })).rejects.toThrow();
  });
});
