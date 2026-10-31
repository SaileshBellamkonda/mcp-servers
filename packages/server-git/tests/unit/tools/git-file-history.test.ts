import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitFileHistory } from '../../../src/tools/git-file-history.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

describe('git_file_history tool', () => {
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

    registerGitFileHistory(server, services);
  });

  it('should register git_file_history tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_file_history');
  });

  it('calls log with correct args including -- filepath', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_file_history');
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      'log',
      '--format=%H|%an|%ad|%s',
      '-n',
      '20',
      '--',
      'src/foo.ts',
    ]);
  });

  it('uses custom limit when limit given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_file_history');
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts', limit: 5 });

    const calledArgs = executeSpy.mock.calls[0]![1];
    const nIdx = calledArgs.indexOf('-n');
    expect(calledArgs[nIdx + 1]).toBe('5');
  });

  it('calls pathValidator.validatePath with repository and filepath', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const validateSpy = vi.spyOn(services.pathValidator, 'validatePath');

    const tool = registeredTool(server, 'git_file_history');
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });

    expect(validateSpy).toHaveBeenCalledWith('/repo', 'src/foo.ts');
  });

  it('parses commit output correctly', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'abc123|John Doe|Mon Jan 1 00:00:00 2024 +0000|refactor: cleanup\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_file_history');
    const result = await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });
    const content = JSON.parse(result.content[0].text);

    expect(content.commits).toHaveLength(1);
    expect(content.commits[0]).toMatchObject({
      hash: 'abc123',
      author: 'John Doe',
      date: 'Mon Jan 1 00:00:00 2024 +0000',
      message: 'refactor: cleanup',
    });
  });

  it('returns empty commits and count 0 when output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_file_history');
    const result = await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });
    const content = JSON.parse(result.content[0].text);

    expect(content.commits).toEqual([]);
    expect(content.count).toBe(0);
    expect(content.filepath).toBe('src/foo.ts');
  });

  it('throws Git file history failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'fatal: bad default revision',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_file_history');
    await expect(
      tool.handler({ repository: '/repo', filepath: 'src/foo.ts' }),
    ).rejects.toThrow('Git file history failed');
  });

  it('throws when pathValidator rejects path (path traversal)', async () => {
    vi.spyOn(services.pathValidator, 'validatePath').mockImplementation(() => {
      throw new Error('Path outside repository');
    });

    const tool = registeredTool(server, 'git_file_history');
    await expect(
      tool.handler({ repository: '/repo', filepath: '../secret' }),
    ).rejects.toThrow();
  });
});
