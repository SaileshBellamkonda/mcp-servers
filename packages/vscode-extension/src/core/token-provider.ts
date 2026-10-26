import { randomBytes } from 'node:crypto';

/**
 * Supplies the bearer token a server requires. `scopeKey` identifies the workspace the token belongs to, so an
 * implementation backed by persistent storage can keep one stable token per server and workspace.
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
