import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGitLog } from '../../../src/tools/git-log.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_log tool', () => {
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

    registerGitLog(server, services);
  });

  it('should register git_log tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_log');
  });

  it('should validate limit parameter', async () => {
    const tool = (server as any)._registeredTools['git_log'];
    await expect(tool.handler({ repository: '/repo', limit: 101 })).rejects.toThrow();
  });
});
