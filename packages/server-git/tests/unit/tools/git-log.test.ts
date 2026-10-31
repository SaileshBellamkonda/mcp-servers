import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitLog } from '../../../src/tools/git-log.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

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
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_log');
  });

  it('should validate limit parameter', async () => {
    const tool = registeredTool(server, 'git_log');
    await expect(tool.handler({ repository: '/repo', limit: 101 })).rejects.toThrow();
  });
});
