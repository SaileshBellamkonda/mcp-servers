import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitWorkspaces } from '../../../src/tools/git-workspaces.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_workspaces tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager(['/repo1', '/repo2']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };

    registerGitWorkspaces(server, services);
  });

  it('should register git_workspaces tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_workspaces');
  });

  it('should return list of allowed repositories', async () => {
    const tool = (server as any)._registeredTools['git_workspaces'];
    const result = await tool.handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories).toHaveLength(2);
    expect(content.repositories[0]).toHaveProperty('path');
    expect(content.repositories[0]).toHaveProperty('name');
  });

  it('should extract repository names from paths', async () => {
    const tool = (server as any)._registeredTools['git_workspaces'];
    const result = await tool.handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories[0].name).toBe('repo1');
    expect(content.repositories[1].name).toBe('repo2');
  });
});
