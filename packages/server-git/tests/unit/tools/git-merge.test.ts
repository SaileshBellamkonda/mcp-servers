import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitMerge } from '../../../src/tools/git-merge.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_merge tool', () => {
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

    registerGitMerge(server, services);
  });

  it('should register git_merge tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_merge');
  });

  it('calls merge with branch only for basic merge', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_merge'];
    await tool.handler({ repository: '/repo', branch: 'feature' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['merge', 'feature']);
  });

  it('calls merge with --no-ff when no_ff is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_merge'];
    await tool.handler({ repository: '/repo', branch: 'feature', no_ff: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['merge', '--no-ff', 'feature']);
  });

  it('calls merge with -m message when message given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_merge'];
    await tool.handler({ repository: '/repo', branch: 'feature', message: 'my msg' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['merge', '-m', 'my msg', 'feature']);
  });

  it('returns conflict response when exitCode != 0 and CONFLICT in output', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'CONFLICT (content): Merge conflict in file.ts\nAutomatic merge failed.',
      stderr: '',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_merge'];
    const result = await tool.handler({ repository: '/repo', branch: 'feature' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(false);
    expect(Array.isArray(content.conflicts)).toBe(true);
    expect(content.conflicts).toContain('CONFLICT (content): Merge conflict in file.ts');
  });

  it('throws on non-conflict git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'branch not found',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_merge'];
    await expect(tool.handler({ repository: '/repo', branch: 'feature' })).rejects.toThrow(
      'Git merge failed',
    );
  });

  it('returns success with branch on successful merge', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'Merge made by the recursive strategy.',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_merge'];
    const result = await tool.handler({ repository: '/repo', branch: 'feature' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.branch).toBe('feature');
  });

  it('does not return conflict when CONFLICT in output but exitCode is 0', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'CONFLICT mentioned but succeeded',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_merge'];
    const result = await tool.handler({ repository: '/repo', branch: 'feature' });
    const content = JSON.parse(result.content[0].text);

    // exitCode 0 means success even if CONFLICT appears in output
    expect(content.success).toBe(true);
  });
});
