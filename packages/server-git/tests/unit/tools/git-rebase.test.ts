import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitRebase } from '../../../src/tools/git-rebase.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.js';

describe('git_rebase tool', () => {
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

    registerGitRebase(server, services);
  });

  it('should register git_rebase tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_rebase');
  });

  it('calls rebase with onto branch for basic rebase', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_rebase');
    await tool.handler({ repository: '/repo', onto: 'main' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['rebase', 'main']);
  });

  it('calls rebase --abort when abort is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_rebase');
    await tool.handler({ repository: '/repo', onto: 'main', abort: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['rebase', '--abort']);
  });

  it('calls rebase --continue when continue_ field is true', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_rebase');
    await tool.handler({ repository: '/repo', onto: 'main', continue_: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['rebase', '--continue']);
  });

  it('calls rebase --continue when JSON continue field is true (maps to continue_)', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_rebase');
    // JSON 'continue' field maps to 'continue_' via the handler's mapping logic
    await tool.handler({ repository: '/repo', onto: 'main', continue: true });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['rebase', '--continue']);
  });

  it('returns conflict response when exitCode != 0 and CONFLICT in output', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'CONFLICT (content): Merge conflict in file.ts',
      stderr: '',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_rebase');
    const result = await tool.handler({ repository: '/repo', onto: 'main' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(false);
    expect(content.conflicts).toContain('CONFLICT (content): Merge conflict in file.ts');
  });

  it('returns onto field in success response for basic rebase', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: 'Successfully rebased.',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_rebase');
    const result = await tool.handler({ repository: '/repo', onto: 'main' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.onto).toBe('main');
  });

  it('does not return onto field in abort success response', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_rebase');
    const result = await tool.handler({ repository: '/repo', onto: 'main', abort: true });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content).not.toHaveProperty('onto');
  });

  it('throws on non-conflict git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'unknown error',
      exitCode: 1,
      success: false,
    });

    const tool = registeredTool(server, 'git_rebase');
    await expect(tool.handler({ repository: '/repo', onto: 'main' })).rejects.toThrow(
      'Git rebase failed',
    );
  });
});
