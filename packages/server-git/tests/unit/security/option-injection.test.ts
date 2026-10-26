import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { createGitServer } from '../../../src/server/git-server.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitExecutor } from '../../../src/core/git-executor.js';

/**
 * Exhaustive option-injection table: for EVERY tool parameter that carries a free-form string into a
 * git command line, feed option-shaped values and prove that the value either never reaches git
 * (the call is rejected) or reaches it only in a position git cannot parse as an option (as the value
 * of a flag that takes one, or after `--` / `--end-of-options`). New tools must be added here.
 */

type Case = { tool: string; param: string; base: Record<string, unknown>; array?: boolean };

const cases: Case[] = [
  { tool: 'git_add', param: 'files', base: {}, array: true },
  { tool: 'git_blame', param: 'filepath', base: {} },
  { tool: 'git_cherry_pick', param: 'commits', base: {}, array: true },
  { tool: 'git_commit', param: 'message', base: {} },
  { tool: 'git_diff', param: 'target', base: {} },
  { tool: 'git_fetch', param: 'remote', base: {} },
  { tool: 'git_fetch', param: 'branch', base: { remote: 'origin' } },
  { tool: 'git_file_history', param: 'filepath', base: {} },
  { tool: 'git_log', param: 'branch', base: {} },
  { tool: 'git_merge', param: 'branch', base: {} },
  { tool: 'git_merge', param: 'message', base: { branch: 'dev' } },
  { tool: 'git_pull', param: 'remote', base: {} },
  { tool: 'git_pull', param: 'branch', base: { remote: 'origin' } },
  { tool: 'git_push', param: 'remote', base: { branch: 'main' } },
  { tool: 'git_push', param: 'branch', base: { remote: 'origin' } },
  { tool: 'git_rebase', param: 'onto', base: {} },
  { tool: 'git_remote_add', param: 'name', base: { url: 'https://example.com/r.git' } },
  { tool: 'git_remote_add', param: 'url', base: { name: 'extra' } },
  { tool: 'git_remote_remove', param: 'name', base: {} },
  { tool: 'git_search', param: 'query', base: {} },
  { tool: 'git_search', param: 'branch', base: { query: 'x' } },
  { tool: 'git_show', param: 'commit', base: {} },
  { tool: 'git_stash', param: 'message', base: { action: 'push' } },
  { tool: 'git_tag', param: 'name', base: { action: 'create' } },
  { tool: 'git_tag', param: 'name', base: { action: 'delete' } },
  { tool: 'git_tag', param: 'message', base: { action: 'create', name: 'v1' } },
  { tool: 'git_tag', param: 'ref', base: { action: 'create', name: 'v1' } },
  { tool: 'git_worktree_add', param: 'path', base: {} },
  { tool: 'git_worktree_add', param: 'branch', base: { path: 'wt' } },
  { tool: 'git_worktree_add', param: 'commitish', base: { path: 'wt' } },
  { tool: 'git_worktree_remove', param: 'path', base: {} },
  { tool: 'git_worktree_lock', param: 'path', base: {} },
  { tool: 'git_worktree_lock', param: 'reason', base: { path: 'wt' } },
  { tool: 'git_worktree_unlock', param: 'path', base: {} },
  { tool: 'git_worktree_move', param: 'source', base: { destination: 'wt2' } },
  { tool: 'git_worktree_move', param: 'destination', base: { source: 'wt' } },
];

/** Tools with no free-form string reaching git (booleans, integers, enums and the repository only). */
const noFreeFormInput = ['git_workspaces', 'git_status', 'git_branch', 'git_reflog', 'git_remote_list', 'git_worktree_list', 'git_worktree_prune'];

const evilValues = [
  '--output=/tmp/mcp-git-sentinel',
  '--upload-pack=touch /tmp/mcp-git-sentinel',
  '--exec=touch /tmp/mcp-git-sentinel',
  '-f',
  '--help',
];

/** Flags whose next argv element is consumed as their value, so the value cannot be parsed as an option. */
const VALUE_CONSUMERS = new Set(['-m', '-S', '--reason', '--', '--end-of-options', '-b']);

describe('option injection table', () => {
  let server: McpServer;
  let calls: string[][];

  beforeEach(() => {
    calls = [];
    vi.spyOn(GitExecutor.prototype, 'execute').mockImplementation(async (_repo, args) => {
      calls.push([...args]);
      const stdout = args.length === 1 && args[0] === 'remote' ? 'origin\n' : args[0] === 'rev-parse' ? 'main\n' : '';
      return { stdout, stderr: '', exitCode: 0, success: true };
    });
    server = new McpServer({ name: 't', version: '1' }, { capabilities: { tools: {} } });
    createGitServer(server, new RepositoryManager(['/repo']));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['GIT_ALLOW_REMOTE_URLS'];
  });

  const registered = (): Record<string, { handler: (i: unknown) => Promise<unknown> }> =>
    (server as unknown as { _registeredTools: Record<string, { handler: (i: unknown) => Promise<unknown> }> })._registeredTools;

  it('classifies every registered tool (add new tools to the table above)', () => {
    const known = new Set([...cases.map((c) => c.tool), ...noFreeFormInput]);
    const unknown = Object.keys(registered()).filter((t) => !known.has(t));
    expect(unknown, 'tools missing from the option-injection table').toEqual([]);
  });

  for (const c of cases) {
    for (const evil of evilValues) {
      it(`${c.tool}.${c.param} (${JSON.stringify(c.base.action ?? '')}) cannot smuggle ${evil.slice(0, 18)} as a git option`, async () => {
        const handler = registered()[c.tool]?.handler;
        expect(handler, `${c.tool} not registered`).toBeDefined();
        await Promise.resolve(handler?.({ repository: '/repo', ...c.base, [c.param]: c.array ? [evil] : evil })).catch(() => undefined);

        for (const argv of calls) {
          argv.forEach((arg, i) => {
            if (arg === evil) {
              const prev = argv[i - 1];
              expect(
                prev !== undefined && VALUE_CONSUMERS.has(prev),
                `${c.tool}.${c.param}: value reached git as a bare argument: git ${argv.join(' ')}`,
              ).toBe(true);
            }
          });
        }
      });
    }
  }
});
