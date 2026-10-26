import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { isLoopbackHost } from './loopback.js';

/** Shortest accepted bearer token (characters). */
export const MIN_TOKEN_LENGTH = 32;
const DEFAULT_HOST = '127.0.0.1';

/** Thrown when an HTTP binding or token configuration is unsafe. Never contains the token. */
export class HttpSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpSecurityError';
  }
}

export interface HttpSecurity {
  host: string;
  token: string | undefined;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time token comparison. Both values are hashed first so the comparison
 * length is fixed and tokens of different lengths cannot be told apart by timing.
 */
export function tokensEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/**
 * Shared safety check for an HTTP binding: a configured token must be at least
 * {@link MIN_TOKEN_LENGTH} characters, and a non-loopback host requires a token.
 * An empty token counts as unset. Error messages never contain the token.
 */
export function assertSafeBinding(binding: { host: string; token: string | undefined }): void {
  const { host, token } = binding;
  const hasToken = token !== undefined && token !== '';
  if (hasToken && token.length < MIN_TOKEN_LENGTH) {
    throw new HttpSecurityError(`MCP_AUTH_TOKEN must be at least ${String(MIN_TOKEN_LENGTH)} characters long`);
  }
  if (!hasToken && !isLoopbackHost(host)) {
    throw new HttpSecurityError(`refusing to bind ${host} without MCP_AUTH_TOKEN (a non-loopback address requires authentication)`);
  }
}

/** Reads `MCP_HTTP_HOST` (default 127.0.0.1) and `MCP_AUTH_TOKEN` and validates the combination. */
export function resolveHttpSecurity(env: Record<string, string | undefined>): HttpSecurity {
  const configuredHost = env['MCP_HTTP_HOST']?.trim();
  const configuredToken = env['MCP_AUTH_TOKEN']?.trim();
  const host = configuredHost === undefined || configuredHost === '' ? DEFAULT_HOST : configuredHost;
  const token = configuredToken === undefined || configuredToken === '' ? undefined : configuredToken;
  assertSafeBinding({ host, token });
  return { host, token };
}

const BEARER = /^bearer ([^\r\n]*)$/i;

/**
 * Hono middleware requiring exactly `Authorization: Bearer <token>` (scheme is case-insensitive,
 * one space). With `undefined` it does nothing. Failures answer a bare 401 that never reveals
 * why and never echoes any token.
 */
export function bearerAuth(token: string | undefined): MiddlewareHandler {
  if (token === undefined) return async (_c, next) => { await next(); };
  const expected = sha256(token);
  return async (c, next) => {
    const supplied = BEARER.exec(c.req.header('authorization') ?? '')?.[1];
    if (supplied === undefined || !timingSafeEqual(sha256(supplied), expected)) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Bearer' });
    }
    await next();
    return undefined;
  };
}
