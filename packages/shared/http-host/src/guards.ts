import type { Context, MiddlewareHandler } from 'hono';
import { isLoopbackHost } from './loopback.js';

/** JSON-RPC style error body used by the host's own rejections (the SDK uses the same shape). */
export function jsonRpcError(c: Context, status: 403 | 404 | 413 | 415 | 429, code: number, message: string, headers?: Record<string, string>): Response {
  return c.json({ jsonrpc: '2.0', error: { code, message }, id: null }, status, headers);
}

const BARE_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#@\s]+$/i;

function isAllowedOrigin(origin: string, allowed: ReadonlySet<string>): boolean {
  const lowered = origin.toLowerCase();
  if (allowed.has(lowered)) return true;
  // Only a bare scheme://host[:port] is an Origin; anything else (null, paths, credentials) is forged.
  if (!BARE_ORIGIN.test(origin)) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (allowed.has(url.host) || allowed.has(url.hostname)) return true;
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
}

/**
 * Rejects (403) any request whose `Origin` header names a foreign site: browsers always send
 * Origin on cross-site requests, so this blocks DNS-rebinding and CSRF against a local server.
 * Loopback origins (any port) and `allowedOrigins` (a full origin or a host name) pass; requests
 * without an Origin header (non-browser clients) are unaffected.
 */
export function originGuard(allowedOrigins: readonly string[] = []): MiddlewareHandler {
  const allowed = new Set(allowedOrigins.map((o) => o.trim().toLowerCase()));
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !isAllowedOrigin(origin, allowed)) {
      return jsonRpcError(c, 403, -32000, 'Forbidden: Origin not allowed');
    }
    await next();
    return undefined;
  };
}

/**
 * POST requests must carry exactly the `application/json` media type (parameters allowed,
 * case-insensitive). The SDK only checks for a substring, which `text/plain;x=application/json`
 * satisfies, so the exact check happens here, and the header is normalised for the SDK.
 */
export function jsonContentType(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'POST') {
      const essence = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (essence !== 'application/json') {
        return jsonRpcError(c, 415, -32000, 'Unsupported Media Type: Content-Type must be application/json');
      }
      if (!(c.req.header('content-type') ?? '').includes('application/json')) {
        const headers = new Headers(c.req.raw.headers);
        headers.set('content-type', 'application/json');
        c.req.raw = new Request(c.req.raw, { headers });
      }
    }
    await next();
    return undefined;
  };
}

/**
 * Caps request bodies at `maxBytes` before anything parses them: 413 when Content-Length is
 * larger, and also while reading (chunked or lying senders). The accepted body is buffered
 * (it is bounded) and handed on as a fresh Request.
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  const tooLarge = (c: Context): Response =>
    jsonRpcError(c, 413, -32000, 'Payload Too Large', { Connection: 'close' });
  return async (c, next) => {
    const raw = c.req.raw;
    if (raw.body === null) return next();
    const declared = raw.headers.get('content-length');
    if (declared !== null && Number(declared) > maxBytes) return tooLarge(c);
    const reader = raw.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return tooLarge(c);
      }
      chunks.push(value);
    }
    c.req.raw = new Request(raw, { body: Buffer.concat(chunks) });
    return next();
  };
}
