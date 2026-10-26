import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Supplies the bearer token a server requires. `scopeKey` identifies the workspace the token belongs to, so an
 * implementation backed by persistent storage can keep one stable token per workspace.
 */
export interface TokenProvider {
  getToken(serverId: string, scopeKey: string): Promise<string>;
}

/** Random 32-byte hex tokens held in memory: stable for the session (restarts reuse them), new in every session. */
export class InMemoryTokenProvider implements TokenProvider {
  private readonly tokens = new Map<string, string>();

  getToken(serverId: string, scopeKey: string): Promise<string> {
    const key = JSON.stringify([serverId, scopeKey]);
    let token = this.tokens.get(key);
    if (token === undefined) {
      token = randomBytes(32).toString('hex');
      this.tokens.set(key, token);
    }
    return Promise.resolve(token);
  }
}

/** Identifies a workspace: the first 16 hex characters of the SHA-256 of its sorted folder URIs. */
const SCOPE_KEY = /^[0-9a-f]{16}$/;

/**
 * The stable id of a workspace. It is a hash of the sorted `file`-scheme folder URIs, so it is the same in every
 * window that opens the same set of folders and changes when a folder is added or removed (and with it the
 * token: a different folder set is a different workspace).
 */
export function computeScopeKey(folderUris: readonly string[]): string {
  return createHash('sha256')
    .update([...folderUris].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** The SecretStorage key holding the token of a workspace scope. */
export function tokenSecretKey(scopeKey: string): string {
  return `mcpServers.token.${scopeKey}`;
}

/** The part of `vscode.SecretStorage` the provider uses (structurally compatible, `Thenable` = `PromiseLike`). */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface SecretStorageTokenProviderOptions {
  /** Called when the file mirror cannot be written (the token itself is never part of the message). */
  onMirrorError?: (error: unknown) => void;
}

const MIN_TOKEN_LENGTH = 32;
/** Printable ASCII without spaces: what the HTTP host accepts in a bearer token. */
const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

function isUsableToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_TOKEN_LENGTH && TOKEN_SHAPE.test(value);
}

function assertScopeKey(scopeKey: string): void {
  if (!SCOPE_KEY.test(scopeKey)) throw new Error('Invalid workspace scope key (expected 16 lowercase hex characters)');
}

/**
 * One stable bearer token per workspace scope, shared by all servers of the workspace.
 *
 * SecretStorage is authoritative. The token is mirrored to `<tokensDir>/<scopeKey>.json` as `{"token": "..."}`
 * (file mode 0600 inside a 0700 directory, written through a temporary 0600 file and an atomic rename) so a
 * command-line helper that cannot reach SecretStorage can still print the `Authorization` header. If the secret is
 * missing but the file holds a valid token (e.g. after migrating the machine), the file's token is adopted.
 * On Windows POSIX modes do not exist: `mode`/`chmod` are best effort there and the file relies on the ACL of the
 * user's profile directory.
 */
export class SecretStorageTokenProvider implements TokenProvider {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly secrets: SecretStore,
    readonly tokensDir: string,
    private readonly options: SecretStorageTokenProviderOptions = {}
  ) {}

  /** The token of the workspace; every server asks with the same scope and gets the same value. */
  getToken(_serverId: string, scopeKey: string): Promise<string> {
    return this.serialised(scopeKey, () => this.resolve(scopeKey));
  }

  /** Replaces the token of the workspace with a new random one and returns it. */
  rotate(scopeKey: string): Promise<string> {
    return this.serialised(scopeKey, async () => {
      const token = randomBytes(32).toString('hex');
      await this.secrets.store(tokenSecretKey(scopeKey), token);
      await this.mirror(scopeKey, token);
      return token;
    });
  }

  /** Path of the mirror file of a scope. */
  tokenFile(scopeKey: string): string {
    assertScopeKey(scopeKey);
    return path.join(this.tokensDir, `${scopeKey}.json`);
  }

  // -------------------------------------------------------------------------------------------------------------
  /** Runs `task` after every earlier task of the same scope, so concurrent callers see one token. */
  private serialised(scopeKey: string, task: () => Promise<string>): Promise<string> {
    let validated: Promise<string>;
    try {
      assertScopeKey(scopeKey);
      const previous = this.pending.get(scopeKey) ?? Promise.resolve('');
      validated = previous.catch(() => '').then(task);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.pending.set(scopeKey, validated);
    const clear = (): void => {
      if (this.pending.get(scopeKey) === validated) this.pending.delete(scopeKey);
    };
    validated.then(clear, clear);
    return validated;
  }

  private async resolve(scopeKey: string): Promise<string> {
    const secretKey = tokenSecretKey(scopeKey);
    const stored = await this.secrets.get(secretKey);
    let token: string;
    if (isUsableToken(stored)) {
      token = stored;
    } else {
      const fromFile = await this.readMirror(scopeKey);
      token = fromFile ?? randomBytes(32).toString('hex');
      await this.secrets.store(secretKey, token);
    }
    await this.mirror(scopeKey, token);
    return token;
  }

  private async readMirror(scopeKey: string): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.tokenFile(scopeKey), 'utf8')) as { token?: unknown } | null;
      return isUsableToken(parsed?.token) ? parsed.token : undefined;
    } catch {
      return undefined;
    }
  }

  /** Makes the file hold exactly `token` with the right modes; failures are reported, never thrown. */
  private async mirror(scopeKey: string, token: string): Promise<void> {
    try {
      await mkdir(this.tokensDir, { recursive: true, mode: 0o700 });
      await chmod(this.tokensDir, 0o700);
      const file = this.tokenFile(scopeKey);
      if ((await this.readMirror(scopeKey)) === token) {
        await chmod(file, 0o600);
        return;
      }
      const temporary = path.join(this.tokensDir, `.${scopeKey}.${randomBytes(6).toString('hex')}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify({ token })}\n`, { mode: 0o600, flag: 'wx' });
        await chmod(temporary, 0o600);
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.options.onMirrorError?.(error);
    }
  }
}
