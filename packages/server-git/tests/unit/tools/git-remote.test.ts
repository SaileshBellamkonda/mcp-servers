import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import {
  registerGitRemoteList,
  registerGitRemoteAdd,
  registerGitRemoteRemove,
} from '../../../src/tools/git-remote.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { GitExecutor } from '../../../src/core/git-executor.ts';
import { OutputParser } from '../../../src/core/output-parser.ts';
import type { Services } from '../../../src/core/types.ts';
import { registeredTool, registeredTools } from '../../fixtures/registered-tools.ts';

function createServerAndServices(): { server: McpServer; services: Services } {
  const server = new McpServer(
    { name: 'test-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const repoManager = new RepositoryManager(['/repo']);
  const services: Services = {
    repoManager,
    pathValidator: new PathValidator(repoManager),
    gitExecutor: new GitExecutor(),
    outputParser: new OutputParser(),
  };

  return { server, services };
}

// ─── git_remote_list ─────────────────────────────────────────────────────────

describe('git_remote_list tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    ({ server, services } = createServerAndServices());
    registerGitRemoteList(server, services);
  });

  it('should register git_remote_list tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_remote_list');
  });

  it('parses git remote -v output and deduplicates by name', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout:
        'origin\thttps://github.com/foo/bar.git\t(fetch)\norigin\thttps://github.com/foo/bar.git\t(push)\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_remote_list');
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.remotes).toHaveLength(1);
    expect(content.remotes[0]).toMatchObject({
      name: 'origin',
      url: 'https://github.com/foo/bar.git',
    });
  });

  it('returns multiple remotes for different names', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: [
        'origin\thttps://github.com/foo/bar.git\t(fetch)',
        'origin\thttps://github.com/foo/bar.git\t(push)',
        'upstream\thttps://github.com/upstream/repo.git\t(fetch)',
        'upstream\thttps://github.com/upstream/repo.git\t(push)',
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_remote_list');
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.remotes).toHaveLength(2);
    expect(content.remotes.map((r: { name: string }) => r.name)).toEqual(['origin', 'upstream']);
  });

  it('returns empty remotes array when output is empty', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_remote_list');
    const result = await tool.handler({ repository: '/repo' });
    const content = JSON.parse(result.content[0].text);

    expect(content.remotes).toEqual([]);
  });

  it('throws on git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'not a git repository',
      exitCode: 128,
      success: false,
    });

    const tool = registeredTool(server, 'git_remote_list');
    await expect(tool.handler({ repository: '/repo' })).rejects.toThrow('Git remote list failed');
  });
});

// ─── git_remote_add ───────────────────────────────────────────────────────────

describe('git_remote_add tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    ({ server, services } = createServerAndServices());
    registerGitRemoteAdd(server, services);
  });

  it('should register git_remote_add tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_remote_add');
  });

  it('calls remote add with name and url', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_remote_add');
    await tool.handler({ repository: '/repo', name: 'upstream', url: 'https://github.com/upstream/repo.git' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', [
      'remote',
      'add',
      'upstream',
      'https://github.com/upstream/repo.git',
    ]);
  });

  it('returns success with name and url', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_remote_add');
    const result = await tool.handler({
      repository: '/repo',
      name: 'upstream',
      url: 'https://github.com/upstream/repo.git',
    });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.name).toBe('upstream');
    expect(content.url).toBe('https://github.com/upstream/repo.git');
  });

  it('throws on git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'remote origin already exists',
      exitCode: 3,
      success: false,
    });

    const tool = registeredTool(server, 'git_remote_add');
    await expect(
      tool.handler({ repository: '/repo', name: 'origin', url: 'https://example.com' }),
    ).rejects.toThrow('Git remote add failed');
  });
});

// ─── git_remote_remove ────────────────────────────────────────────────────────

describe('git_remote_remove tool', () => {
  let server: McpServer;
  let services: Services;

  beforeEach(() => {
    ({ server, services } = createServerAndServices());
    registerGitRemoteRemove(server, services);
  });

  it('should register git_remote_remove tool', () => {
    const tools = Object.keys(registeredTools(server));
    expect(tools).toContain('git_remote_remove');
  });

  it('calls remote remove with name', async () => {
    const executeSpy = vi
      .spyOn(services.gitExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

    const tool = registeredTool(server, 'git_remote_remove');
    await tool.handler({ repository: '/repo', name: 'upstream' });

    expect(executeSpy).toHaveBeenCalledWith('/repo', ['remote', 'remove', 'upstream']);
  });

  it('returns success with name', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const tool = registeredTool(server, 'git_remote_remove');
    const result = await tool.handler({ repository: '/repo', name: 'upstream' });
    const content = JSON.parse(result.content[0].text);

    expect(content.success).toBe(true);
    expect(content.name).toBe('upstream');
  });

  it('throws on git failure', async () => {
    vi.spyOn(services.gitExecutor, 'execute').mockResolvedValue({
      stdout: '',
      stderr: 'error: No such remote: upstream',
      exitCode: 2,
      success: false,
    });

    const tool = registeredTool(server, 'git_remote_remove');
    await expect(tool.handler({ repository: '/repo', name: 'upstream' })).rejects.toThrow(
      'Git remote remove failed',
    );
  });
});
