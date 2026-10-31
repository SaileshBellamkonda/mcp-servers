import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitWorkspaces } from '../../../src/tools/git-workspaces.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

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
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_workspaces');
  });

  it('should return list of allowed repositories', async () => {
    const tool = registeredTool(server, 'git_workspaces');
    const result = await tool.handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories).toHaveLength(2);
    expect(content.repositories[0]).toHaveProperty('path');
    expect(content.repositories[0]).toHaveProperty('name');
  });

  it('should extract repository names from paths', async () => {
    const tool = registeredTool(server, 'git_workspaces');
    const result = await tool.handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories[0].name).toBe('repo1');
    expect(content.repositories[1].name).toBe('repo2');
  });
});
