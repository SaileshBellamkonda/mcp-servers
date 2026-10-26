import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { GitExecutor } from '../../src/core/git-executor.js';
import { TestRepository } from '../fixtures/test-repo.js';

const execFileAsync = promisify(execFile);

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

describe('repository-local git config cannot run commands', () => {
  let repo: TestRepository;
  let scratch: string;
  let sentinel: string;
  let server: McpServer;

  beforeEach(async () => {
    repo = await TestRepository.create();
    await repo.writeFile('a.txt', 'a');
    await repo.commit('first');
    scratch = await mkdtemp(join(tmpdir(), 'git-cfg-'));
    sentinel = join(scratch, 'sentinel');
    server = new McpServer({ name: 'test-server', version: '1.0.0' }, { capabilities: { tools: {} } });
    createGitServer(server, new RepositoryManager([repo.path]));
  });

  afterEach(async () => {
    await repo.cleanup();
    await rm(scratch, { recursive: true, force: true });
  });

  it('does not run core.fsmonitor from .git/config during git_status', async () => {
    await execFileAsync('git', ['config', 'core.fsmonitor', `touch ${sentinel}; true`], { cwd: repo.path });
    // Control: plain git does run it, so the test can fail for the right reason.
    await execFileAsync('git', ['status'], { cwd: repo.path });
    expect(existsSync(sentinel)).toBe(true);
    await rm(sentinel);

    const handler = (server as unknown as { _registeredTools: Record<string, { handler: Handler }> })
      ._registeredTools['git_status']!.handler;
    const out = await handler({ repository: repo.path });
    expect(out.content[0]!.text).toContain('branch');
    expect(existsSync(sentinel)).toBe(false);
  });

  it('still leaves ordinary repository config (user identity) in effect', async () => {
    const exec = new GitExecutor(undefined, new RepositoryManager([repo.path]));
    const res = await exec.execute(repo.path, ['config', 'user.name']);
    expect(res.stdout.trim()).toBe('Test User');
  });
});
