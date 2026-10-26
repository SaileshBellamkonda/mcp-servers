import { describe, expect, it } from 'vitest';
import { computeHeaders } from '../../src/helper/headers';

const SCOPE = 'abcdef0123456789';
const TOKEN = 't'.repeat(64);

function files(map: Record<string, string>): (file: string) => string {
  return (file) => {
    const content = map[file.replaceAll('\\', '/')];
    if (content === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' });
    return content;
  };
}

describe('computeHeaders', () => {
  const read = files({ [`/tokens/${SCOPE}.json`]: JSON.stringify({ token: TOKEN }) });

  it('prints the Authorization header as one JSON object', () => {
    const result = computeHeaders([SCOPE, '--dir', '/tokens'], {}, read);
    expect(result).toEqual({ ok: true, stdout: `{"Authorization":"Bearer ${TOKEN}"}\n` });
    expect(JSON.parse((result.ok && result.stdout) || '')).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('accepts --dir=<path> and the flag before the scope key', () => {
    expect(computeHeaders(['--dir=/tokens', SCOPE], {}, read).ok).toBe(true);
    expect(computeHeaders(['--dir', '/tokens', SCOPE], {}, read).ok).toBe(true);
  });

  it('falls back to MCP_SERVERS_TOKENS_DIR when --dir is absent; --dir wins', () => {
    expect(computeHeaders([SCOPE], { MCP_SERVERS_TOKENS_DIR: '/tokens' }, read).ok).toBe(true);
    expect(computeHeaders([SCOPE, '--dir', '/tokens'], { MCP_SERVERS_TOKENS_DIR: '/elsewhere' }, read).ok).toBe(true);
  });

  it('fails without a scope key or a directory, explaining usage', () => {
    const noScope = computeHeaders(['--dir', '/tokens'], {}, read);
    expect(noScope).toMatchObject({ ok: false });
    expect(noScope.ok === false && noScope.message).toMatch(/usage/i);
    const noDir = computeHeaders([SCOPE], {}, read);
    expect(noDir.ok === false && noDir.message).toMatch(/--dir/);
  });

  it('rejects a scope key that is not 16 hex characters (no path traversal)', () => {
    const result = computeHeaders(['../../etc/passwd', '--dir', '/tokens'], {}, read);
    expect(result.ok === false && result.message).toMatch(/scope/i);
  });

  it('rejects unknown arguments', () => {
    expect(computeHeaders([SCOPE, '--dir', '/tokens', '--verbose'], {}, read).ok).toBe(false);
    expect(computeHeaders([SCOPE, SCOPE, '--dir', '/tokens'], {}, read).ok).toBe(false);
  });

  it('fails clearly when the file is missing, without printing a token', () => {
    const result = computeHeaders([SCOPE, '--dir', '/nowhere'], {}, read);
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
    const result = computeHeaders([SCOPE, '--dir', '/tokens'], {}, files({ [`/tokens/${SCOPE}.json`]: content }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).not.toContain('short');
    expect(result.ok === false && result.message).not.toContain('nope');
  });
});
