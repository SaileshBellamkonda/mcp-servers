import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGitBlame } from '../../../src/tools/git-blame.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

// Porcelain blame output for a single line
const HASH = 'a'.repeat(40);
const PORCELAIN_OUTPUT = [
  `${HASH} 1 1 1`,
  'author Alice',
  'author-time 1700000000',
  'author-tz +0000',
  'summary initial',
  `filename src/foo.ts`,
  '\thello world',
].join('\n');

describe('git_blame tool', () => {
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

    registerGitBlame(server, services);
  });

  it('should register git_blame tool', () => {
    const tools = Object.keys((server as any)._registeredTools);
    expect(tools).toContain('git_blame');
  });

  it('calls blame --porcelain -- filepath with no line range', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: PORCELAIN_OUTPUT, stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_blame'];
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['blame', '--porcelain', '--', 'src/foo.ts']);
  });

  it('calls blame with -L start,start when only start_line given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: PORCELAIN_OUTPUT, stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_blame'];
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts', start_line: 5 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['blame', '--porcelain', '-L', '5,5', '--', 'src/foo.ts']);
  });

  it('calls blame with -L start,end when both line numbers given', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: PORCELAIN_OUTPUT, stderr: '', exitCode: 0, success: true });

    const tool = (server as any)._registeredTools['git_blame'];
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts', start_line: 3, end_line: 7 });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['blame', '--porcelain', '-L', '3,7', '--', 'src/foo.ts']);
  });

  it('parses porcelain output correctly', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: PORCELAIN_OUTPUT,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_blame'];
    const result = await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.lines).toHaveLength(1);
    expect(content.lines[0]).toMatchObject({
      line: 1,
      hash: HASH,
      author: 'Alice',
      timestamp: new Date(1700000000 * 1000).toISOString(),
      content: 'hello world',
    });
  });

  it('calls pathValidator.validatePath with repository and filepath', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: PORCELAIN_OUTPUT,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const validateSpy = vi.spyOn(services.pathValidator, 'validatePath');

    const tool = (server as any)._registeredTools['git_blame'];
    await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });

    expect(validateSpy).toHaveBeenCalledWith('/repo', 'src/foo.ts');
  });

  it('throws when pathValidator rejects the filepath (path traversal)', async () => {
    vi.spyOn(services.pathValidator, 'validatePath').mockImplementation(() => {
      throw new Error('Path outside repository');
    });

    const tool = (server as any)._registeredTools['git_blame'];
    await expect(
      tool.handler({ repository: '/repo', filepath: '../secret' }),
    ).rejects.toThrow();
  });

  it('throws Git blame failed on git error', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'fatal: no such path',
      exitCode: 1,
      success: false,
    });

    const tool = (server as any)._registeredTools['git_blame'];
    await expect(
      tool.handler({ repository: '/repo', filepath: 'src/foo.ts' }),
    ).rejects.toThrow('Git blame failed');
  });

  it('returns filepath in response', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: PORCELAIN_OUTPUT,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = (server as any)._registeredTools['git_blame'];
    const result = await tool.handler({ repository: '/repo', filepath: 'src/foo.ts' });
    const content = JSON.parse(result.content[0].text);

    expect(content.filepath).toBe('src/foo.ts');
  });
});
