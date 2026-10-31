import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestRepository } from '../../fixtures/test-repo.ts';
import { TOKEN, freePort, spawnStandalone, type StandaloneProcess } from '../../fixtures/standalone-process.ts';

describe('standalone git logging', () => {
  let repo: TestRepository;
  let proc: StandaloneProcess | undefined;
  let scratch: string;

  beforeEach(async () => {
    repo = await TestRepository.create();
    scratch = mkdtempSync(path.join(tmpdir(), 'git-standalone-logging-'));
  });

  afterEach(async () => {
    proc?.kill();
    await proc?.exited;
    proc = undefined;
    await repo.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  });

  async function startHttp(extra: Record<string, string>): Promise<void> {
    const port = await freePort();
    proc = spawnStandalone({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: TOKEN,
      GIT_ALLOWED_REPOS: repo.path,
      ...extra,
    });
  }

  it('writes timestamped entries to LOG_FILE (creating its directory) and nothing to stderr', async () => {
    const file = path.join(scratch, 'logs', 'git.log');
    await startHttp({ LOG_FILE: file });
    await proc?.waitForLog(/Git MCP Server ready/);

    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[INFO\] \[http-host\] MCP HTTP server listening on http:\/\/127\.0\.0\.1:\d+\/mcp/m);
    expect(text).toMatch(/\[INFO\] \[git-server\] Git MCP Server ready\. Allowed repositories: /);
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('writes nothing anywhere when LOG_FILE is not set', async () => {
    await startHttp({ LOG_FILE: '' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(proc?.log()).toBe('');
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('filters entries by LOG_LEVEL', async () => {
    const file = path.join(scratch, 'git.log');
    await startHttp({ LOG_FILE: file, LOG_LEVEL: 'warning' });
    // The unauthenticated warning is not emitted (a token is set) and the info lines are below the threshold.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('');
    expect(proc?.stderr()).toBe('');
  }, 30000);

  it('exits with a FATAL message on stderr when LOG_LEVEL is invalid', async () => {
    await startHttp({ LOG_LEVEL: 'loud' });
    const { code } = (await proc?.exited) ?? { code: null };

    expect(code).not.toBe(0);
    expect(proc?.stderr()).toMatch(/\[FATAL\].*LOG_LEVEL.*loud/);
  }, 30000);
});
