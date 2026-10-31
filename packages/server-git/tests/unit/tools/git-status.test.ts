import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitStatus } from '../../../src/tools/git-status.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.js';

describe('git_status tool', () => {
  let server: McpServer;
  let services: Services;
  let mockExecutor: GitExecutor;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager(['/repo']);
    mockExecutor = new GitExecutor();
    
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: mockExecutor,
      outputParser: new OutputParser()
    };

    registerGitStatus(server, services);
  });

  it('should register git_status tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_status');
  });

  it('should validate repository parameter', async () => {
    const tool = registeredTool(server, 'git_status');
    
    await expect(tool.handler({ repository: '/invalid' })).rejects.toThrow();
  });

  it('should return structured status output', async () => {
    vi.spyOn(mockExecutor, 'execute').mockResolvedValue({
      stdout: '## main\n M file.ts',
      stderr: '',
      exitCode: 0,
      success: true
    });

    const tool = registeredTool(server, 'git_status');
    const result = await tool.handler({ repository: '/repo' });
    
    const content = JSON.parse(result.content[0].text);
    expect(content).toHaveProperty('branch');
    expect(content).toHaveProperty('files');
    expect(Array.isArray(content.files)).toBe(true);
  });
});
