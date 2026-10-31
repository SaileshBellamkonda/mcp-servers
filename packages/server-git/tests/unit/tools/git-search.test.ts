import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitSearch } from '../../../src/tools/git-search.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

describe('git_search tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser(),
    };

    registerGitSearch(server, services);
  });

  it('should register git_search tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_search');
  });

  it('uses --grep for message search type', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_search');
    await tool.handler({ repository: '/repo', query: 'fix', search_type: 'message' });

    const calledArgs = executeSpy.mock.calls[0]![1];
    expect(calledArgs).toContain('--grep=fix');
  });

  it('uses -S for diff search type', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_search');
    await tool.handler({ repository: '/repo', query: 'fix', search_type: 'diff' });

    const calledArgs = executeSpy.mock.calls[0]![1];
    expect(calledArgs).toContain('-S');
    expect(calledArgs).toContain('fix');
  });

  it('includes branch in args when branch given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_search');
    await tool.handler({ repository: '/repo', query: 'fix', branch: 'develop' });

    const calledArgs = executeSpy.mock.calls[0]![1];
    expect(calledArgs).toContain('develop');
  });

  it('uses custom limit when limit given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_search');
    await tool.handler({ repository: '/repo', query: 'fix', limit: 5 });

    const calledArgs = executeSpy.mock.calls[0]![1];
    const nIdx = calledArgs.indexOf('-n');
    expect(calledArgs[nIdx + 1]).toBe('5');
  });

  it('parses pipe-delimited commit lines correctly', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'abc123|John Doe|Mon Jan 1 00:00:00 2024 +0000|add feature\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_search');
    const result = await tool.handler({ repository: '/repo', query: 'feature' });
    const content = JSON.parse(result.content[0].text);

    expect(content.commits).toHaveLength(1);
    expect(content.commits[0]).toMatchObject({
      hash: 'abc123',
      author: 'John Doe',
      date: 'Mon Jan 1 00:00:00 2024 +0000',
      message: 'add feature',
    });
  });

  it('handles message with pipe characters (joins remaining parts)', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'abc123|John Doe|2024-01-01|fix: foo|bar\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_search');
    const result = await tool.handler({ repository: '/repo', query: 'fix' });
    const content = JSON.parse(result.content[0].text);

    expect(content.commits[0].message).toBe('fix: foo|bar');
  });

  it('returns empty commits and count 0 when output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_search');
    const result = await tool.handler({ repository: '/repo', query: 'nothing' });
    const content = JSON.parse(result.content[0].text);

    expect(content.commits).toEqual([]);
    expect(content.count).toBe(0);
  });

  it('throws Git search failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'fatal: bad revision',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_search');
    await expect(
      tool.handler({ repository: '/repo', query: 'fix' }),
    ).rejects.toThrow('Git search failed');
  });
});
