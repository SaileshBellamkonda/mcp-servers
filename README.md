# MCP Servers

A pnpm monorepo of [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers written in TypeScript.
Each server runs in two ways from the same code:

- **Standalone:** a Node.js process that speaks MCP over stdio (default) or Streamable HTTP.
- **Inside the VS Code extension:** the same servers run in the extension host, listen on `127.0.0.1` and require a
  bearer token. See [packages/vscode-extension](packages/vscode-extension/README.md).

## Packages

| Package | Path | What it is |
|---|---|---|
| `@mcp-servers/server-git` | [packages/server-git](packages/server-git/README.md) | Git operations (30 tools) on an allow-list of repositories |
| `@mcp-servers/server-coderag` | [packages/server-coderag](packages/server-coderag/README.md) | Semantic, keyword and hybrid search over code and Markdown/MDX through an OpenAI-compatible embeddings endpoint (11 tools) |
| `mcp-servers` (VS Code extension) | [packages/vscode-extension](packages/vscode-extension/README.md) | Hosts both servers in VS Code, manages their tokens, registers them with VS Code and writes Claude Code configuration |
| `@mcp-servers/common` | [packages/shared/common](packages/shared/common/README.md) | Private. Env parsing helpers and `McpLogger` |
| `@mcp-servers/http-host` | [packages/shared/http-host](packages/shared/http-host/README.md) | Private. The secured Streamable HTTP host both servers use |

The two `shared/*` packages are `private` and never published. The servers and the extension inline them at build time
(esbuild), so a built server needs no unpublished package. Third-party dependencies, including the native ones
(`tree-sitter*`, `sqlite-vec`), stay external.

The extension's package name is `mcp-servers`, the same as the root package; see
[Development](#development) for the consequence for `pnpm --filter`.

## Requirements

- Node.js **24 or later** for standalone use (`engines.node` is `>=24.0.0` in every package). `server-coderag` uses
  `node:sqlite` with FTS5.
- pnpm 12 to build from source (`devEngines` in the root `package.json` requires pnpm `^12.0.0` and Node `^24.0.0`, and also lets npm run so you can bootstrap pnpm with `npm install -g pnpm@12`).
- `git` on `PATH` for `server-git`.

## Quick start

Build once from the repository root:

```sh
pnpm install
pnpm build
```

The examples below use the built entry points in `packages/*/dist/standalone.js`. After installing a package, its `bin`
is `git-mcp-server` or `coderag-mcp-server`. List-valued variables use `;` as the separator on every platform.

### Git server

stdio (the default transport):

```sh
GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2" node packages/server-git/dist/standalone.js
```

HTTP (listens on `127.0.0.1:3000`, endpoint `/mcp`):

```sh
export MCP_AUTH_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
MCP_TRANSPORT=http GIT_ALLOWED_REPOS="/path/to/repo" node packages/server-git/dist/standalone.js
```

`GIT_ALLOWED_REPOS` is required; the process exits with an error when it is missing or empty.

### CodeRAG server

CodeRAG needs an OpenAI-compatible embeddings endpoint (for example Ollama) and the path of its SQLite database file.
It indexes relative to the current working directory, so start it in the project you want to search.

stdio:

```sh
CODERAG_EMBEDDING_URL="http://localhost:11434/v1" \
CODERAG_EMBEDDING_MODEL="nomic-embed-text" \
CODERAG_DB_PATH="/path/to/coderag.db" \
node /path/to/mcp-servers/packages/server-coderag/dist/standalone.js
```

HTTP (listens on `127.0.0.1:3100`, endpoint `/mcp`): add `MCP_TRANSPORT=http` and `MCP_AUTH_TOKEN` as above. All
`CODERAG_*` variables are listed in the [package README](packages/server-coderag/README.md).

### Connecting a client

[`mcp.example.json`](mcp.example.json) holds ready-to-adapt entries in the `.mcp.json` format of Claude Code. JSON has
no comments, so the entries are explained here:

| Entry | Use |
|---|---|
| `git-stdio`, `coderag-stdio` | The client starts the server itself. Replace the `/absolute/path/to/mcp-servers` prefix, the repository list and the embeddings settings. |
| `git-http`, `coderag-http` | The server already runs in HTTP mode. The header is `Authorization: Bearer ${MCP_AUTH_TOKEN}`; Claude Code expands `${VAR}` in `url` and `headers` from its own environment, so export the same `MCP_AUTH_TOKEN` there. |
| `vscode-git` | Shape of the entries that the extension's "MCP Servers: Add to Claude Code..." command writes: a `headersHelper` command that prints the `Authorization` header from the extension's `0600` token file, so the token is never in the file. Replace the paths and `<scope>` (16 hex characters, derived from the workspace folders), or let the extension write the real entry. |

Copy the entries you need into your `.mcp.json` (merge them under `mcpServers`). The file contains only placeholders; do
not put a real token in it. The same HTTP endpoint also works with `claude mcp add --transport http <name> <url>
--header "Authorization: Bearer <token>"`.

## HTTP security model

Both servers share the host in `@mcp-servers/http-host`. Standalone HTTP mode is configured with environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `http` selects the HTTP transport (case-insensitive); anything else is stdio |
| `MCP_HTTP_HOST` | `127.0.0.1` | Interface to bind |
| `MCP_HTTP_PORT` | `3000` (git), `3100` (CodeRAG) | TCP port, 0 to 65535; `0` picks a free port |
| `MCP_AUTH_TOKEN` | unset | Bearer token, at least 32 characters, no whitespace-only value or control characters |

What the host enforces:

- It always passes a host name to `listen`; the default is the IPv4 loopback address `127.0.0.1`.
- **A non-loopback `MCP_HTTP_HOST` (including `0.0.0.0` and `::`) is refused unless `MCP_AUTH_TOKEN` is set.** A token
  shorter than 32 characters is refused in every case. The process exits with a `[FATAL] HttpSecurityError` message
  that never contains the token.
- Without a token the server runs unauthenticated and logs `auth: disabled` plus a warning; any local process can then
  call its tools. Set a token whenever other users or processes share the machine.
- With a token, every request needs exactly `Authorization: Bearer <token>`; otherwise the answer is a bare `401` with
  `WWW-Authenticate: Bearer`. Comparison is constant time (SHA-256 digests with `timingSafeEqual`).
- The `Host` header is validated on loopback binds (DNS-rebinding protection).
- A request with an `Origin` header is rejected with `403` unless the origin is a loopback origin (any port) or is in
  `allowedOrigins`. Requests without `Origin` (non-browser clients) are unaffected.
  `allowedOrigins` is an option of `startMcpHttpServer`; the standalone servers do not expose it through an environment
  variable.
- `POST` needs `Content-Type: application/json` (parameters allowed), otherwise `415`.
- Limits (defaults of `startMcpHttpServer`, not configurable from the standalone environment): 64 concurrent sessions
  (further initializations get `429` with `Retry-After`), a session expires after 30 minutes without any request for it
  (clients re-initialize after a `404`), request bodies larger than 4 MiB get `413`.
- Each session gets its own `McpServer`; the domain services (repositories, vector database) are shared.

Not provided: TLS, rate limiting, OAuth, per-tool authorization. Put the server behind a reverse proxy if you need TLS.

Embedded in VS Code, the host binds `127.0.0.1` only and a token is mandatory; see the extension README for the token
model.

## Development

```sh
pnpm install
pnpm build        # pnpm -r run build: shared packages, servers (esbuild bundle + declarations), extension
pnpm typecheck    # pnpm -r run typecheck
pnpm test         # pnpm -r run test (Vitest)
pnpm lint         # eslint .
```

Run one package's script with a path filter, for example `pnpm --filter ./packages/server-git run test`.

**Filter naming caveat:** the VS Code extension's package name is `mcp-servers`, which is also the name of the root
package, so `pnpm --filter mcp-servers ...` matches both. Select the extension with
`pnpm --filter ./packages/vscode-extension ...`. The other packages can be selected by name
(`--filter @mcp-servers/server-coderag`).

`pnpm -C packages/server-git run dev` (and the same for `server-coderag`) runs the standalone entry point from source
with `tsx`.

Project rules for contributors and agents are in [AGENTS.md](AGENTS.md); the system design is in
[docs/DESIGN.md](docs/DESIGN.md).

## VS Code extension

The extension (`packages/vscode-extension`, VS Code 1.125 or later) starts the Git server and, where the runtime
supports it, CodeRAG inside the extension host. It adds an **MCP Servers** view with start, stop and restart, registers
the servers in VS Code's own MCP server list, keeps one stable bearer token per workspace in Secret Storage, and can
write a Claude Code `.mcp.json` entry that fetches that token through a helper script. Settings, commands, the token
model and packaging are documented in [its README](packages/vscode-extension/README.md).

## License

MIT, as declared in each `package.json`. The repository does not contain a `LICENSE` file yet.
