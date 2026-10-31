import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/server';
import { createGitServer } from '../../src/server/git-server.ts';
import { RepositoryManager } from '../../src/core/repository-manager.ts';

const execFileAsync = promisify(execFile);

/**
 * Option-injection regression suite (audit finding S6). Every case feeds a git option (or another
 * dangerous value) through a free-form string input and proves, with real repositories and harmless
 * sentinel files inside a temp dir, that the call is rejected and no side effect happened.
 */
describe('git argument injection (real repositories)', () => {
  let parent: string;
  let repo: string;
  let origin: string;
  let server: McpServer;
  let sentinel: string;
  let victim: string;

  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    const registered = (server as unknown as { _registeredTools: Record<string, { handler: (i: unknown) => Promise<unknown> }> })
      ._registeredTools[tool];
    if (registered === undefined) throw new Error(`tool not registered: ${tool}`);
    return registered.handler({ repository: repo, ...args });
  };
  const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);
  const git = (cwd: string, ...args: string[]): Promise<{ stdout: string }> => execFileAsync('git', args, { cwd });

  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'git-inj-'));
    repo = join(parent, 'repo');
    origin = join(parent, 'origin.git');
    sentinel = join(parent, 'pwned');
    victim = join(parent, 'victim.txt');
    await execFileAsync('git', ['init', '--bare', '-b', 'main', origin]);
    await execFileAsync('git', ['init', '-b', 'main', repo]);
    await git(repo, 'config', 'user.name', 'T');
    await git(repo, 'config', 'user.email', 't@example.com');
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, 'add', 'a.txt');
    await git(repo, 'commit', '-m', 'init');
    await git(repo, 'remote', 'add', 'origin', origin);
    await git(repo, 'push', '-u', 'origin', 'main');
    // A local commit ahead of upstream so that `git rebase --exec=...` really has something to run on.
    await writeFile(join(repo, 'c.txt'), 'two\n');
    await git(repo, 'add', 'c.txt');
    await git(repo, 'commit', '-m', 'second');
    server = new McpServer({ name: 't', version: '1' }, { capabilities: { tools: {} } });
    createGitServer(server, new RepositoryManager([repo]));
  });

  // Start every case from a pristine state so one failing (vulnerable) case cannot cascade into the next.
  beforeEach(async () => {
    await rm(sentinel, { recursive: true, force: true });
    await rm(join(parent, 'elsewhere'), { recursive: true, force: true });
    await rm(join(parent, 'elsewhere2'), { recursive: true, force: true });
    await git(repo, 'reset', '-q', '--hard', 'main').catch(() => undefined);
    await git(repo, 'rebase', '--abort').catch(() => undefined);
    await git(repo, 'merge', '--abort').catch(() => undefined);
    await git(repo, 'cherry-pick', '--abort').catch(() => undefined);
    const tags = (await git(repo, 'tag', '--list')).stdout.split('\n').filter(Boolean);
    for (const t of tags) await git(repo, 'tag', '-d', t);
    const remotes = (await git(repo, 'remote')).stdout.split('\n').filter((r) => r !== '' && r !== 'origin');
    for (const r of remotes) await git(repo, 'remote', 'remove', r);
  });

  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  const evilUpload = (): string => `--upload-pack=touch ${sentinel}`;
  const evilReceive = (): string => `--receive-pack=touch ${sentinel}`;
  const evilExec = (): string => `--exec=touch ${sentinel}`;
  const evilOutput = (): string => `--output=${sentinel}`;

  const cases: Array<[string, string, () => Record<string, unknown>]> = [
    ['fetch remote --upload-pack', 'git_fetch', () => ({ remote: evilUpload(), branch: '.' })],
    ['fetch branch --upload-pack', 'git_fetch', () => ({ remote: 'origin', branch: evilUpload() })],
    ['pull remote --upload-pack', 'git_pull', () => ({ remote: evilUpload(), branch: '.' })],
    ['pull branch --upload-pack', 'git_pull', () => ({ remote: 'origin', branch: evilUpload() })],
    ['push remote --receive-pack', 'git_push', () => ({ remote: evilReceive(), branch: origin })],
    ['push branch --receive-pack', 'git_push', () => ({ remote: 'origin', branch: evilReceive() })],
    ['rebase onto --exec', 'git_rebase', () => ({ onto: evilExec() })],
    ['diff target --output', 'git_diff', () => ({ target: evilOutput() })],
    ['log branch --output', 'git_log', () => ({ branch: evilOutput() })],
    ['search branch --output', 'git_search', () => ({ query: 'x', branch: evilOutput() })],
    ['show commit --output', 'git_show', () => ({ commit: evilOutput() })],
    ['show commit --help', 'git_show', () => ({ commit: '--help' })],
    ['tag create name -f', 'git_tag', () => ({ action: 'create', name: '-f', ref: 'HEAD' })],
    ['tag create ref --output', 'git_tag', () => ({ action: 'create', name: 'v1', ref: evilOutput() })],
    ['tag delete name -f', 'git_tag', () => ({ action: 'delete', name: '-f' })],
    ['cherry-pick --abort', 'git_cherry_pick', () => ({ commits: ['--abort'] })],
    ['cherry-pick --exec-ish', 'git_cherry_pick', () => ({ commits: [evilExec()] })],
    ['merge --abort', 'git_merge', () => ({ branch: '--abort' })],
    ['merge --output', 'git_merge', () => ({ branch: evilOutput() })],
    ['remote add ext:: url', 'git_remote_add', () => ({ name: 'evil', url: `ext::sh -c "touch ${sentinel}"` })],
    ['remote add option-like name', 'git_remote_add', () => ({ name: '--help', url: origin })],
    ['remote add option-like url', 'git_remote_add', () => ({ name: 'evil2', url: evilUpload() })],
    ['remote remove option-like name', 'git_remote_remove', () => ({ name: '-v' })],
    ['fetch ext:: url as remote', 'git_fetch', () => ({ remote: `ext::sh -c "touch ${sentinel}"`, branch: 'x' })],
    ['fetch arbitrary URL', 'git_fetch', () => ({ remote: origin })],
    ['push arbitrary URL', 'git_push', () => ({ remote: origin, branch: 'main' })],
    ['pull arbitrary URL', 'git_pull', () => ({ remote: origin, branch: 'main' })],
    ['add --pathspec-from-file', 'git_add', () => ({ files: ['--pathspec-from-file=/etc/hostname'] })],
    ['add --all', 'git_add', () => ({ files: ['--all'] })],
    ['add :/ magic', 'git_add', () => ({ files: [':/'] })],
    ['add :(top) magic', 'git_add', () => ({ files: [':(top)a.txt'] })],
    ['add glob', 'git_add', () => ({ files: ['*.txt'] })],
    ['worktree add branch option', 'git_worktree_add', () => ({ path: join(repo, 'wt1'), branch: evilOutput() })],
    ['worktree add commitish option', 'git_worktree_add', () => ({ path: join(repo, 'wt2'), commitish: '--detach' })],
    ['worktree remove outside repo', 'git_worktree_remove', () => ({ path: join(parent, 'elsewhere') })],
    ['worktree remove option-like path', 'git_worktree_remove', () => ({ path: '../elsewhere' })],
    ['worktree lock outside repo', 'git_worktree_lock', () => ({ path: join(parent, 'elsewhere') })],
    ['worktree unlock outside repo', 'git_worktree_unlock', () => ({ path: join(parent, 'elsewhere') })],
    ['worktree move source outside', 'git_worktree_move', () => ({ source: join(parent, 'elsewhere'), destination: join(repo, 'wt3') })],
    ['worktree move destination outside', 'git_worktree_move', () => ({ source: join(repo, 'wt3'), destination: join(parent, 'elsewhere2') })],
  ];

  it.each(cases)('rejects and has no side effect: %s', async (_label, tool, args) => {
    await writeFile(victim, 'IMPORTANT DATA\n');
    await expect(call(tool, args())).rejects.toThrow();
    expect(await exists(sentinel), 'sentinel file was created: injection executed').toBe(false);
    expect(await readFile(victim, 'utf8'), 'victim file was modified').toBe('IMPORTANT DATA\n');
    expect(await exists(join(parent, 'elsewhere')), 'path outside the repo was touched').toBe(false);
    expect((await git(repo, 'tag', '--list')).stdout.trim(), 'a tag was created or deleted').toBe('');
    expect((await git(repo, 'remote')).stdout.trim(), 'remote set changed').toBe('origin');
  });

  it('git_add error text does not leak the contents of a file named via --pathspec-from-file', async () => {
    const secret = join(parent, 'secret-pathspec.txt');
    await writeFile(secret, 'TOP-SECRET-LINE\n');
    const err = await call('git_add', { files: [`--pathspec-from-file=${secret}`] }).then(
      () => '',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(err).not.toBe('');
    expect(err).not.toContain('TOP-SECRET-LINE');
  });

  it('still works for legitimate use: configured remote name, plain refs, explicit file add', async () => {
    await expect(call('git_fetch', { remote: 'origin' })).resolves.toBeDefined();
    await expect(call('git_fetch', { remote: 'origin', branch: 'main' })).resolves.toBeDefined();
    await expect(call('git_push', { remote: 'origin', branch: 'main' })).resolves.toBeDefined();
    await expect(call('git_log', { branch: 'main' })).resolves.toBeDefined();
    await expect(call('git_show', { commit: 'HEAD' })).resolves.toBeDefined();
    await expect(call('git_diff', { target: 'HEAD' })).resolves.toBeDefined();
    await writeFile(join(repo, 'b..c.txt'), 'x\n');
    await expect(call('git_add', { files: ['b..c.txt'] })).resolves.toBeDefined();
    await git(repo, 'reset', '-q');
  });
});
