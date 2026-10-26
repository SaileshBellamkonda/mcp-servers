import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { mkdtemp, rm, symlink, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { GitExecutor } from '../../src/core/git-executor.js';
import { TestRepository } from '../fixtures/test-repo.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

describe('allow-list is enforced on the real path', () => {
  let allowed: TestRepository;
  let hostile: TestRepository;
  let scratch: string;
  let server: McpServer;

  const handler = (name: string): Handler =>
    (server as unknown as { _registeredTools: Record<string, { handler: Handler }> })._registeredTools[name]!.handler;

  beforeEach(async () => {
    allowed = await TestRepository.create();
    await allowed.writeFile('a.txt', 'a');
    await allowed.commit('allowed commit');
    hostile = await TestRepository.create();
    await hostile.writeFile('h.txt', 'h');
    await hostile.writeFile('deep/f.txt', 'f');
    await hostile.commit('hostile commit');
    scratch = await mkdtemp(join(tmpdir(), 'git-link-'));
    // A symlink a hostile repository could commit: allowed/lnk -> <hostile>/deep, so lnk/.. is the hostile repo.
    await symlink(join(hostile.path, 'deep'), join(allowed.path, 'lnk'));
    server = new McpServer({ name: 'test-server', version: '1.0.0' }, { capabilities: { tools: {} } });
    createGitServer(server, new RepositoryManager([allowed.path]));
  });

  afterEach(async () => {
    await allowed.cleanup();
    await hostile.cleanup();
    await rm(scratch, { recursive: true, force: true });
  });

  it('refuses the symlink itself', async () => {
    await expect(handler('git_log')({ repository: join(allowed.path, 'lnk') })).rejects.toThrow(/not allowed/i);
  });

  it.each([
    ['git_log', {}],
    ['git_status', {}],
    ['git_commit', { message: 'x' }],
    ['git_add', { files: ['a.txt'] }],
    ['git_branch', {}],
    ['git_worktree_list', {}],
  ])('refuses <allowed>/lnk/.. for %s', async (tool, extra) => {
    const repository = `${allowed.path}${sep}lnk${sep}..`;
    await expect(handler(tool)({ repository, ...extra })).rejects.toThrow(/not allowed|\.\./i);
  });

  it('refuses any ".." segment even when it stays inside the allowed repo', async () => {
    await expect(handler('git_status')({ repository: `${allowed.path}${sep}sub${sep}..` })).rejects.toThrow();
  });

  it('works for the allowed repository (plain, trailing slash, dot)', async () => {
    for (const repository of [allowed.path, allowed.path + sep, join(allowed.path, '.')]) {
      const out = await handler('git_log')({ repository });
      expect(out.content[0]!.text).toContain('allowed commit');
    }
  });

  it('works when the allowed root is itself a symlink', async () => {
    const link = join(scratch, 'root-link');
    await symlink(allowed.path, link);
    const s = new McpServer({ name: 't', version: '1' }, { capabilities: { tools: {} } });
    createGitServer(s, new RepositoryManager([link]));
    const h = (s as unknown as { _registeredTools: Record<string, { handler: Handler }> })._registeredTools['git_log']!.handler;
    expect((await h({ repository: link })).content[0]!.text).toContain('allowed commit');
    expect((await h({ repository: allowed.path })).content[0]!.text).toContain('allowed commit');
  });

  it('refuses a nonexistent repository', async () => {
    await expect(handler('git_status')({ repository: join(scratch, 'nope') })).rejects.toThrow();
  });

  it('runs git in the validated real path, not the raw input', async () => {
    const link = join(scratch, 'root-link');
    await symlink(allowed.path, link);
    const seen: string[] = [];
    class Spy extends GitExecutor {
      override async execute(...args: Parameters<GitExecutor['execute']>) {
        seen.push(args[0]);
        return super.execute(...args);
      }
    }
    const mgr = new RepositoryManager([link]);
    const exec = new Spy(undefined, mgr);
    // The executor itself validates and resolves, so a tool that forgets validateRepository is still safe.
    const real = await realpath(allowed.path);
    const res = await exec.execute(link, ['rev-parse', '--show-toplevel']);
    expect(res.stdout.trim()).toBe(real);
    await expect(exec.execute(hostile.path, ['status'])).rejects.toThrow(/not allowed/i);
    await expect(exec.execute(`${allowed.path}${sep}lnk${sep}..`, ['log'])).rejects.toThrow();
    expect(seen.length).toBe(3);
  });
});
