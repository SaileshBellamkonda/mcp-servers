import { describe, expect, it } from 'vitest';
import { deriveServerToken, isValidServerId } from '../../src/core/server-token';

const WORKSPACE_TOKEN = 'a'.repeat(64);

describe('deriveServerToken', () => {
  it('is HMAC-SHA256(key = workspace token, data = "mcp-servers:<serverId>") as 64 hex characters', () => {
    // Known answers computed independently (python hmac): changing the scheme would break every .mcp.json helper call.
    expect(deriveServerToken(WORKSPACE_TOKEN, 'git')).toBe('5f23f76091246e2aedadb4b1ff02453b34716689aca0efa5e451b54ff6a837a4');
    expect(deriveServerToken(WORKSPACE_TOKEN, 'coderag')).toBe('6d31353505e285ba357926b669b7b28c1267cc1ab7b21dba0d931896ca49ef12');
  });

  it('is stable, differs per server and per workspace token, and never equals the workspace token', () => {
    const git = deriveServerToken(WORKSPACE_TOKEN, 'git');
    expect(deriveServerToken(WORKSPACE_TOKEN, 'git')).toBe(git);
    expect(deriveServerToken(WORKSPACE_TOKEN, 'coderag')).not.toBe(git);
    expect(deriveServerToken('b'.repeat(64), 'git')).not.toBe(git);
    expect(git).not.toBe(WORKSPACE_TOKEN);
  });

  it('refuses a server id that is not a plain lowercase word', () => {
    for (const bad of ['', 'Git', '1git', 'git server', '../x', 'a'.repeat(33), 'git\n']) {
      expect(() => deriveServerToken(WORKSPACE_TOKEN, bad), JSON.stringify(bad)).toThrow(/server id/i);
    }
  });
});

describe('isValidServerId', () => {
  it('accepts lowercase words with digits and dashes up to 32 characters', () => {
    for (const ok of ['git', 'coderag', 'server-files', 'a', 'a1-b2', 'a'.repeat(32)]) expect(isValidServerId(ok), ok).toBe(true);
    for (const bad of ['', '-a', 'A', 'a_b', 'a'.repeat(33)]) expect(isValidServerId(bad), bad).toBe(false);
  });
});
