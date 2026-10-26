import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deriveServerToken } from '../../src/core/server-token';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const run = promisify(execFile);
const bundle = inject('bundle');
const SCOPE = 'abcdef0123456789';
const TOKEN = 'k'.repeat(64);
const GIT = deriveServerToken(TOKEN, 'git');
const CODERAG = deriveServerToken(TOKEN, 'coderag');

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built dist/mcp-headers.js with the real Node, as a headersHelper would be run. */
async function helper(args: string[], env: NodeJS.ProcessEnv = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [bundle.helperJs, ...args], { env: { PATH: process.env['PATH'], ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('dist/mcp-headers.js (the Claude Code headersHelper script)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mcp-headers-'));
    mkdirSync(path.join(dir, 'tokens dir'), { mode: 0o700 });
    writeFileSync(path.join(dir, 'tokens dir', `${SCOPE}.json`), JSON.stringify({ token: TOKEN }), { mode: 0o600 });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a single self-contained file that requires nothing but Node built-ins', () => {
    const code = readFileSync(bundle.helperJs, 'utf8');
    const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
    const required = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1] ?? '');
    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((id) => !builtins.has(id))).toEqual([]);
    expect(statSync(bundle.helperJs).size).toBeLessThan(20_000);
  });

  it('prints the Authorization header JSON of the server for the scope found in --dir (a path with a space)', async () => {
    const out = await helper([SCOPE, 'git', '--dir', path.join(dir, 'tokens dir')]);
    expect(out.code).toBe(0);
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout)).toEqual({ Authorization: `Bearer ${GIT}` });
    expect(out.stdout).not.toContain(TOKEN);
  });

  it('prints a different, stable token for each server, none of them the workspace token', async () => {
    const args = (serverId: string): string[] => [SCOPE, serverId, '--dir', path.join(dir, 'tokens dir')];
    const [git, coderag, gitAgain] = await Promise.all([helper(args('git')), helper(args('coderag')), helper(args('git'))]);
    expect(git.stdout).toBe(gitAgain.stdout);
    expect(coderag.stdout).not.toBe(git.stdout);
    expect(JSON.parse(coderag.stdout)).toEqual({ Authorization: `Bearer ${CODERAG}` });
    expect(`${git.stdout}${coderag.stdout}`).not.toContain(TOKEN);
  });

  it('reads the directory from MCP_SERVERS_TOKENS_DIR when --dir is not given', async () => {
    const out = await helper([SCOPE, 'git'], { MCP_SERVERS_TOKENS_DIR: path.join(dir, 'tokens dir') });
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ Authorization: `Bearer ${GIT}` });
  });

  it('exits 1 with a message on stderr and nothing on stdout when the token file is missing', async () => {
    const out = await helper(['0123456789abcdef', 'git', '--dir', path.join(dir, 'tokens dir')]);
    expect(out.code).toBe(1);
    expect(out.stdout).toBe('');
    expect(out.stderr).toMatch(/^mcp-headers: cannot read the token file/);
    expect(out.stderr).not.toContain(TOKEN);
  });

  it('exits 1 for bad arguments without touching the file system', async () => {
    for (const args of [[], ['../../x', 'git', '--dir', dir], [SCOPE], [SCOPE, 'git'], [SCOPE, '../git', '--dir', dir], [SCOPE, 'Git', '--dir', dir], [SCOPE, '--dir', dir]]) {
      const out = await helper(args);
      expect(out.code, JSON.stringify(args)).toBe(1);
      expect(out.stdout).toBe('');
      expect(out.stderr).toMatch(/^mcp-headers: /);
    }
  });

  it('exits 1 and does not echo a corrupt file', async () => {
    const bad = path.join(dir, 'bad');
    mkdirSync(bad);
    writeFileSync(path.join(bad, `${SCOPE}.json`), '{"token": "short-secret"}');
    const out = await helper([SCOPE, 'git', '--dir', bad]);
    expect(out.code).toBe(1);
    expect(out.stderr).not.toContain('short-secret');
    if (process.platform !== 'win32') chmodSync(path.join(bad, `${SCOPE}.json`), 0o600);
  });

  it('is built next to the extension bundle', () => {
    expect(path.dirname(bundle.helperJs)).toBe(path.dirname(bundle.extensionJs));
    expect(existsSync(bundle.helperJs)).toBe(true);
  });
});
