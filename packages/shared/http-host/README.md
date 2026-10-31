# @mcp-servers/http-host

The secured Streamable HTTP host behind `server-git` and `server-coderag` (standalone HTTP mode and embedded in the VS
Code extension). **Private** (`"private": true`, never published): consumers inline it at build time with esbuild.

## Usage

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { startMcpHttpServer } from '@mcp-servers/http-host';

const host = await startMcpHttpServer({
  createServer: () => new McpServer({ name: 'example', version: '1.0.0' }),  // called once per session
  port: 3000,
  token: process.env['MCP_AUTH_TOKEN'],
});
// serves POST/GET/DELETE http://127.0.0.1:3000/mcp
await host.close();
```

`createServer` must build a **new `McpServer` for every session** (an `McpServer` can only be connected to one
transport); share domain services such as a database through the closure.

## `startMcpHttpServer(options)`

Resolves once the socket is listening; a listen error such as `EADDRINUSE` rejects with the original error. Returns
`{ address, port, host, sessions, close() }`; `close()` stops accepting, closes every transport and server, drops all
connections and frees the port.

| Option | Default | Meaning |
|---|---|---|
| `createServer` | required | Factory called for each new session |
| `port` | required | TCP port; `0` picks a free port |
| `host` | `127.0.0.1` | Interface to bind. The host name is always passed to `listen` |
| `token` | none | Bearer token, at least 32 characters, no control characters. Empty counts as unset |
| `logger` | silent | `{ info, warning, error }`; `McpLogger` fits |
| `allowedHosts` | localhost names (loopback binds) | Accepted `Host` header values |
| `allowedOrigins` | none | Extra browser origins (`https://app.example`) or host names; loopback origins are always accepted |
| `maxSessions` | `64` | Concurrent sessions; more initializations get `429` with `Retry-After: 5` |
| `sessionIdleTimeoutMs` | `1800000` (30 minutes) | Closes a session after this long without a request for it; `0` disables |
| `maxBodyBytes` | `4194304` (4 MiB) | Larger request bodies get `413` before parsing |
| `onSessionCreated` | none | Called with `{ sessionId, server, transport }` after initialization; errors are logged and ignored |

Safety rules, applied before any request body is read:

- A non-loopback `host` without a token throws `HttpSecurityError`; a token shorter than 32 characters always throws.
- With a token, requests need exactly `Authorization: Bearer <token>` (scheme case-insensitive), otherwise a bare `401`
  with `WWW-Authenticate: Bearer`. Tokens are compared in constant time (SHA-256 digests, `timingSafeEqual`) and never
  logged or echoed.
- A request with an `Origin` header is answered `403` unless the origin is loopback or listed in `allowedOrigins`.
- `POST` needs `Content-Type: application/json`, otherwise `415`.
- An unknown session id gives `404`; a missing id on `GET`/`DELETE` gives `400`.
- Without a token the host logs `auth: disabled` and a warning.

## Other exports

| Export | Description |
|---|---|
| `resolveHttpSecurity(env)` | Reads `MCP_HTTP_HOST` (default `127.0.0.1`) and `MCP_AUTH_TOKEN`, trims them and validates the pair; returns `{ host, token }` |
| `requireToken(token)` | For hosts that must always authenticate (embedded servers): returns the token or throws `HttpSecurityError` |
| `assertSafeBinding({ host, token })` | The check `startMcpHttpServer` runs |
| `bearerAuth(token)` | Hono middleware; a no-op for `undefined` |
| `tokensEqual(a, b)` | Constant-time string comparison |
| `isLoopbackHost(host)` | True for `127.0.0.0/8`, `localhost`, `::1`, `[::1]`; false for wildcard addresses |
| `HttpSecurityError`, `MIN_TOKEN_LENGTH` (32) | Error class (messages never contain the token) and the minimum token length |

## `@mcp-servers/http-host/testing`

Test helpers, kept out of the main entry point: `startTestServer(options)` (ephemeral port, silent logger, trivial
server; returns the host plus `url`), `postJsonRpc`, `initializeSession`, `openEventStream` and `SseParser`.

## Development

```sh
pnpm --filter @mcp-servers/http-host run build
pnpm --filter @mcp-servers/http-host run test
pnpm --filter @mcp-servers/http-host run typecheck
```

Workspace consumers resolve the `@mcp-servers/source` export condition to `src/*.ts`, so no build is needed during
development. Coverage thresholds are 85 %. `@modelcontextprotocol/*` is pinned to an exact alpha version.
