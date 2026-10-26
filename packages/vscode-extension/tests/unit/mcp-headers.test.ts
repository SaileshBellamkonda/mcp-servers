import { describe, expect, it } from 'vitest';
import { deriveServerToken } from '../../src/core/server-token';
import { computeHeaders } from '../../src/helper/headers';

const SCOPE = 'abcdef0123456789';
const TOKEN = 't'.repeat(64);
const GIT = deriveServerToken(TOKEN, 'git');

function files(map: Record<string, string>): (file: string) => string {
  return (file) => {
    const content = map[file.replaceAll('\\', '/')];
    if (content === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' });
    return content;
  };
}

describe('computeHeaders', () => {
  const read = files({ [`/tokens/${SCOPE}.json`]: JSON.stringify({ token: TOKEN }) });

  it('prints the Authorization header of the server as one JSON object, with the derived token and never the workspace token', () => {
    const result = computeHeaders([SCOPE, 'git', '--dir', '/tokens'], {}, read);
    expect(result).toEqual({ ok: true, stdout: `{"Authorization":"Bearer ${GIT}"}\n` });
    expect(result.ok && result.stdout).not.toContain(TOKEN);
    expect(JSON.parse((result.ok && result.stdout) || '')).toEqual({ Authorization: `Bearer ${GIT}` });
  });

  it('derives a different token per server', () => {
    const coderag = computeHeaders([SCOPE, 'coderag', '--dir', '/tokens'], {}, read);
    expect(coderag).toEqual({ ok: true, stdout: `{"Authorization":"Bearer ${deriveServerToken(TOKEN, 'coderag')}"}\n` });
    expect(coderag.ok && coderag.stdout).not.toContain(GIT);
  });

  it('accepts --dir=<path> and the flag before the positional arguments', () => {
    expect(computeHeaders(['--dir=/tokens', SCOPE, 'git'], {}, read).ok).toBe(true);
    expect(computeHeaders(['--dir', '/tokens', SCOPE, 'git'], {}, read).ok).toBe(true);
  });

  it('falls back to MCP_SERVERS_TOKENS_DIR when --dir is absent; --dir wins', () => {
    expect(computeHeaders([SCOPE, 'git'], { MCP_SERVERS_TOKENS_DIR: '/tokens' }, read).ok).toBe(true);
    expect(computeHeaders([SCOPE, 'git', '--dir', '/tokens'], { MCP_SERVERS_TOKENS_DIR: '/elsewhere' }, read).ok).toBe(true);
  });

  it('fails without a scope key, a server id or a directory, explaining usage', () => {
    const noScope = computeHeaders(['--dir', '/tokens'], {}, read);
    expect(noScope).toMatchObject({ ok: false });
    expect(noScope.ok === false && noScope.message).toMatch(/usage/i);
    const noServer = computeHeaders([SCOPE, '--dir', '/tokens'], {}, read);
    expect(noServer.ok === false && noServer.message).toMatch(/server id/i);
    expect(noServer.ok === false && noServer.message).toMatch(/Add to Claude Code/);
    const noDir = computeHeaders([SCOPE, 'git'], {}, read);
    expect(noDir.ok === false && noDir.message).toMatch(/--dir/);
  });

  it.each(['Git', '../x', '1git', 'git server', '', 'a'.repeat(33)])('rejects the server id %j without reading any file', (serverId) => {
    const reads: string[] = [];
    const result = computeHeaders([SCOPE, serverId, '--dir', '/tokens'], {}, (file) => {
      reads.push(file);
      return read(file);
    });
    expect(result.ok).toBe(false);
    expect(reads).toEqual([]);
  });

  it('rejects a scope key that is not 16 hex characters (no path traversal)', () => {
    const result = computeHeaders(['../../etc/passwd', 'git', '--dir', '/tokens'], {}, read);
    expect(result.ok === false && result.message).toMatch(/scope/i);
  });

  it('rejects unknown arguments', () => {
    expect(computeHeaders([SCOPE, 'git', '--dir', '/tokens', '--verbose'], {}, read).ok).toBe(false);
    expect(computeHeaders([SCOPE, 'git', 'coderag', '--dir', '/tokens'], {}, read).ok).toBe(false);
  });

  it('fails clearly when the file is missing, without printing a token', () => {
    const result = computeHeaders([SCOPE, 'git', '--dir', '/nowhere'], {}, read);
    expect(result.ok === false && result.message).toMatch(/ENOENT/);
    expect(result.ok === false && result.message).toMatch(/MCP Servers/);
  });

  it.each([
    ['not JSON', 'nope'],
    ['no token', '{}'],
    ['a short token', JSON.stringify({ token: 'short' })],
    ['a token with whitespace', JSON.stringify({ token: `${'a'.repeat(40)} b` })],
    ['a non-string token', JSON.stringify({ token: 5 })],
  ])('fails when the file contains %s, and never echoes file content', (_name, content) => {
    const result = computeHeaders([SCOPE, 'git', '--dir', '/tokens'], {}, files({ [`/tokens/${SCOPE}.json`]: content }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).not.toContain('short');
    expect(result.ok === false && result.message).not.toContain('nope');
  });
});
