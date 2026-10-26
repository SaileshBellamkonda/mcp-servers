import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeScopeKey, SecretStorageTokenProvider, tokenSecretKey, type SecretStore } from '../../src/core/token-provider';

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  readonly store_ = vi.fn();
  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }
  store(key: string, value: string): Promise<void> {
    this.store_(key);
    this.values.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const SCOPE = 'abcdef0123456789';
const OTHER_SCOPE = '0123456789abcdef';
const posix = process.platform !== 'win32';

describe('computeScopeKey', () => {
  const a = 'file:///work/a';
  const b = 'file:///work/b';

  it('is 16 lowercase hex characters', () => {
    expect(computeScopeKey([a])).toMatch(/^[0-9a-f]{16}$/);
    expect(computeScopeKey([])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable and independent of the order of the folders', () => {
    expect(computeScopeKey([a, b])).toBe(computeScopeKey([b, a]));
    expect(computeScopeKey([a, b])).toBe(computeScopeKey([a, b]));
  });

  it('changes when a folder is added or removed (documented: the token follows the folder set)', () => {
    const keys = new Set([computeScopeKey([a]), computeScopeKey([b]), computeScopeKey([a, b]), computeScopeKey([])]);
    expect(keys.size).toBe(4);
  });

  it('is the first 16 hex characters of the SHA-256 of the sorted URIs joined by newlines', () => {
    // Pinned: changing the scheme would orphan every stored token and every .mcp.json helper call.
    expect(computeScopeKey([a])).toBe('6acd6bbe3c978647');
    expect(computeScopeKey([b, a])).toBe('950dcd99e6992bd4');
  });
});

describe('SecretStorageTokenProvider', () => {
  let root: string;
  let dir: string;
  let secrets: MemorySecrets;
  let onMirrorError: ReturnType<typeof vi.fn>;

  const make = (): SecretStorageTokenProvider => new SecretStorageTokenProvider(secrets, dir, { onMirrorError });
  const fileOf = (scope = SCOPE): string => path.join(dir, `${scope}.json`);
  const readFileToken = (scope = SCOPE): string => (JSON.parse(readFileSync(fileOf(scope), 'utf8')) as { token: string }).token;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'token-provider-'));
    dir = path.join(root, 'globalStorage', 'tokens');
    secrets = new MemorySecrets();
    onMirrorError = vi.fn();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('generates one 64-hex token per scope, stores it in SecretStorage and mirrors it to <scope>.json', async () => {
    const token = await make().getToken('git', SCOPE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.values.get(tokenSecretKey(SCOPE))).toBe(token);
    expect(readFileToken()).toBe(token);
    expect(JSON.parse(readFileSync(fileOf(), 'utf8'))).toEqual({ token });
    expect(readdirSync(dir)).toEqual([`${SCOPE}.json`]);
  });

  it('namespaces the secret key', () => {
    expect(tokenSecretKey(SCOPE)).toBe(`mcpServers.token.${SCOPE}`);
  });

  it('gives all servers of a workspace the same token, even when they ask at the same time', async () => {
    const provider = make();
    const tokens = await Promise.all([provider.getToken('git', SCOPE), provider.getToken('coderag', SCOPE), provider.getToken('git', SCOPE)]);
    expect(new Set(tokens).size).toBe(1);
    expect(secrets.store_).toHaveBeenCalledTimes(1);
  });

  it('keeps the token across provider instances (a new session) and across calls', async () => {
    const first = await make().getToken('git', SCOPE);
    expect(await make().getToken('coderag', SCOPE)).toBe(first);
  });

  it('uses a different token and file per workspace scope', async () => {
    const provider = make();
    const a = await provider.getToken('git', SCOPE);
    const b = await provider.getToken('git', OTHER_SCOPE);
    expect(a).not.toBe(b);
    expect(readFileToken(OTHER_SCOPE)).toBe(b);
  });

  it.runIf(posix)('writes the file with mode 0600 and creates the directory with mode 0700', async () => {
    await make().getToken('git', SCOPE);
    expect(statSync(fileOf()).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.runIf(posix)('corrects a pre-existing wider file mode and directory mode', async () => {
    const provider = make();
    const token = await provider.getToken('git', SCOPE);
    chmodSync(fileOf(), 0o644);
    chmodSync(dir, 0o755);
    expect(await make().getToken('git', SCOPE)).toBe(token);
    expect(statSync(fileOf()).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.runIf(posix)('replaces a pre-existing world-readable file by renaming a 0600 temp file over it', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fileOf(), '{"token":"stale"}', { mode: 0o666 });
    chmodSync(fileOf(), 0o666);
    const token = await make().getToken('git', SCOPE);
    expect(statSync(fileOf()).mode & 0o777).toBe(0o600);
    expect(readFileToken()).toBe(token);
  });

  it('SecretStorage is authoritative: a file with another token is overwritten with the secret', async () => {
    secrets.values.set(tokenSecretKey(SCOPE), 's'.repeat(64));
    mkdirSync(dir, { recursive: true });
    writeFileSync(fileOf(), JSON.stringify({ token: 'f'.repeat(64) }));
    expect(await make().getToken('git', SCOPE)).toBe('s'.repeat(64));
    expect(readFileToken()).toBe('s'.repeat(64));
  });

  it('re-creates a missing mirror file from the secret', async () => {
    const provider = make();
    const token = await provider.getToken('git', SCOPE);
    rmSync(fileOf());
    expect(await make().getToken('git', SCOPE)).toBe(token);
    expect(readFileToken()).toBe(token);
  });

  it('adopts a valid token from the file when the secret is missing (machine migration) and stores it as the secret', async () => {
    mkdirSync(dir, { recursive: true });
    const migrated = 'm'.repeat(40);
    writeFileSync(fileOf(), JSON.stringify({ token: migrated }));
    expect(await make().getToken('git', SCOPE)).toBe(migrated);
    expect(secrets.values.get(tokenSecretKey(SCOPE))).toBe(migrated);
  });

  it.each([
    ['too short', JSON.stringify({ token: 'short' })],
    ['not JSON', 'not json'],
    ['no token field', JSON.stringify({ other: 'x'.repeat(64) })],
    ['a non-string token', JSON.stringify({ token: 12345 })],
    ['a token with whitespace', JSON.stringify({ token: `${'x'.repeat(40)} ${'y'.repeat(10)}` })],
  ])('generates a fresh token when the file is unusable (%s)', async (_name, content) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fileOf(), content);
    const token = await make().getToken('git', SCOPE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileToken()).toBe(token);
  });

  it('regenerates when the stored secret is unusable', async () => {
    secrets.values.set(tokenSecretKey(SCOPE), 'short');
    const token = await make().getToken('git', SCOPE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.values.get(tokenSecretKey(SCOPE))).toBe(token);
  });

  it('rotate() creates a new token, updates the secret and the file, and later calls return it', async () => {
    const provider = make();
    const old = await provider.getToken('git', SCOPE);
    const rotated = await provider.rotate(SCOPE);
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe(old);
    expect(secrets.values.get(tokenSecretKey(SCOPE))).toBe(rotated);
    expect(readFileToken()).toBe(rotated);
    expect(await provider.getToken('coderag', SCOPE)).toBe(rotated);
    expect(await make().getToken('git', SCOPE)).toBe(rotated);
  });

  it('rotate() works before any token exists', async () => {
    const rotated = await make().rotate(SCOPE);
    expect(readFileToken()).toBe(rotated);
  });

  it('rejects scope keys that are not 16 hex characters (no path traversal through the file name)', async () => {
    const provider = make();
    for (const bad of ['../../etc/passwd', 'ABCDEF0123456789', 'short', '', `${SCOPE}/x`]) {
      await expect(provider.getToken('git', bad)).rejects.toThrow(/scope/i);
      await expect(provider.rotate(bad)).rejects.toThrow(/scope/i);
    }
  });

  it('still returns the token when the mirror cannot be written, and reports the failure without the token', async () => {
    mkdirSync(path.dirname(dir), { recursive: true });
    writeFileSync(dir, 'a file where the tokens directory should be');
    const token = await make().getToken('git', SCOPE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.values.get(tokenSecretKey(SCOPE))).toBe(token);
    expect(onMirrorError).toHaveBeenCalledOnce();
    expect(String((onMirrorError.mock.calls[0] as unknown[])[0])).not.toContain(token);
  });

  it('leaves no temporary files behind', async () => {
    const provider = make();
    await provider.getToken('git', SCOPE);
    await provider.rotate(SCOPE);
    await provider.rotate(SCOPE);
    expect(readdirSync(dir)).toEqual([`${SCOPE}.json`]);
  });

  describe('two windows sharing one SecretStorage', () => {
    /** Delays every store until `expected` calls arrived, then applies them in arrival order (a first-run race). */
    class RacingSecrets extends MemorySecrets {
      private waiting: { key: string; value: string; done: () => void }[] = [];
      constructor(private readonly expected: number) {
        super();
      }
      override store(key: string, value: string): Promise<void> {
        return new Promise<void>((resolve) => {
          this.waiting.push({ key, value, done: resolve });
          if (this.waiting.length < this.expected) return;
          for (const { key: k, value: v, done } of this.waiting) {
            this.values.set(k, v);
            done();
          }
          this.waiting = [];
        });
      }
    }

    it('adopts the stored value after generating a token, so providers racing the first run end up with one token', async () => {
      const shared = new RacingSecrets(2);
      const a = new SecretStorageTokenProvider(shared, dir, { onMirrorError });
      const b = new SecretStorageTokenProvider(shared, dir, { onMirrorError });
      const [fromA, fromB] = await Promise.all([a.getToken('git', SCOPE), b.getToken('git', SCOPE)]);
      expect(fromA).toBe(fromB);
      expect(fromA).toBe(shared.values.get(tokenSecretKey(SCOPE)));
      expect(readFileToken()).toBe(fromA);
    });

    it('rotate() also returns whatever ended up stored when two windows rotate at the same time', async () => {
      const shared = new RacingSecrets(2);
      const a = new SecretStorageTokenProvider(shared, dir, { onMirrorError });
      const b = new SecretStorageTokenProvider(shared, dir, { onMirrorError });
      const [fromA, fromB] = await Promise.all([a.rotate(SCOPE), b.rotate(SCOPE)]);
      expect(fromA).toBe(fromB);
      expect(readFileToken()).toBe(fromA);
    });
  });

  it('exposes where the mirror lives', () => {
    expect(make().tokensDir).toBe(dir);
  });
});
