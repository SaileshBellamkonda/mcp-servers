# MCP Servers for VS Code

Runs [Model Context Protocol](https://modelcontextprotocol.io/) servers inside the VS Code extension host, so
MCP clients can use them without a separate process.

- **Git** - safe, controlled Git operations on the repositories of your workspace folders.
- **CodeRAG** - semantic search over code and Markdown through an OpenAI-compatible embeddings endpoint. It runs inside
  the extension host and only where the runtime supports it (see [CodeRAG availability](#coderag-availability)).

Every server listens on `127.0.0.1` only and requires a bearer token (one stable token per workspace, see
[Token model](#token-model); it is never shown or copied). The **MCP Servers** view in the activity bar and the status
bar entry show the state of each server (stopped, starting, running, error, or unavailable with the reason as the
description); the status bar counts the running servers.

## Behaviour

- **Auto-start:** with `mcpServers.git.autoStart` on (the default), the Git server starts when VS Code opens with a
  workspace folder, and when you open a folder later. Without a folder the server is *unavailable* ("Open a folder to
  use the Git server"). CodeRAG's `autoStart` is **off** by default because starting it indexes the workspace; start it
  from the view, the palette, or the MCP servers list of VS Code.
- **Workspace folders:** adding or removing a folder changes the workspace identity, and with it the token (see
  [Token model](#token-model)), so running servers restart with the new folder list; closing the last folder stops them.
- **Settings:** changing `port` or, for CodeRAG, any of its settings except `autoStart` restarts a running server and
  tells you. Changes are applied 500 ms after the last edit, so editing several settings causes one restart. A taken
  port is reported as "Port N is already in use (change mcpServers.git.port)"; any other startup failure shows its real
  message once.
- **Shutdown:** all servers are stopped when the extension deactivates (CodeRAG closes its indexer and database), so no
  port stays bound.

## Commands

Available from the Command Palette (category *MCP Servers*), as inline buttons on a tree item and in its context menu.
From the palette with several candidates you pick the server; with exactly one it is used directly.

| Command | |
|---|---|
| `MCP Servers: Start Server` | Start a stopped (or failed) server |
| `MCP Servers: Stop Server` | Stop a running server |
| `MCP Servers: Restart Server` | Restart a running server (keeps its token) |
| `MCP Servers: Copy Server URL` | Copies `http://127.0.0.1:<port>/mcp` (never the token) |
| `MCP Servers: Add to Claude Code...` | Pick servers, then write `.mcp.json`, copy `claude mcp add-json` commands, or copy a client config (see [Claude Code](#claude-code)) |
| `MCP Servers: Rotate Server Token` | Replaces the workspace token (asks first; restarts running servers) |
| `MCP Servers: Set CodeRAG API Key` | Stores the embeddings API key in VS Code Secret Storage (masked input) |
| `MCP Servers: Clear CodeRAG API Key` | Removes it; a running CodeRAG restarts without it |

## Settings

| Setting | Default | |
|---|---|---|
| `mcpServers.git.autoStart` | `true` | Start the Git server when a workspace folder is open |
| `mcpServers.git.port` | `3000` | Port of the Git server (`0` picks a free port) |
| `mcpServers.coderag.autoStart` | `false` | Start CodeRAG when a workspace folder is open (indexing costs CPU, disk and embedding requests) |
| `mcpServers.coderag.port` | `3100` | Port of the CodeRAG server (`0` picks a free port) |
| `mcpServers.coderag.embeddingUrl` | *(required)* | Base URL of the OpenAI-compatible embeddings endpoint, e.g. `http://localhost:11434/v1`. **Machine scoped** |
| `mcpServers.coderag.embeddingModel` | *(required)* | Embedding model name, e.g. `nomic-embed-text` |
| `mcpServers.coderag.embeddingDim` | `768` | Vector dimensions; must match the model (a different value resets the vectors and re-indexes) |
| `mcpServers.coderag.chunkSize` | `500` | Target chunk size in characters |
| `mcpServers.coderag.topK` | `5` | Default number of search results |
| `mcpServers.coderag.docsInclude` / `codeInclude` | `[]` | Glob patterns to index; empty = Markdown / the supported languages in the workspace folders. **Machine scoped** |
| `mcpServers.coderag.docsExclude` / `codeExclude` | `[]` | Glob patterns to leave out |
| `mcpServers.coderag.useGitignore` | `true` | Skip files ignored by `.gitignore` |
| `mcpServers.coderag.allowedRoots` | `[]` | Extra absolute directories the CodeRAG file tools may use. **Machine scoped** |

There is deliberately **no API key setting**: the embeddings API key is stored with `MCP Servers: Set CodeRAG API Key`
in Secret Storage and handed to CodeRAG in memory only. The index is one SQLite database per workspace in the
extension's workspace storage; with several workspace folders all of them are indexed into that one database.

## CodeRAG availability

CodeRAG needs `node:sqlite` with FTS5, the sqlite-vec extension and tree-sitter, so it is enabled only where all
of them load and is reported as unavailable (with the reason) elsewhere.

| Host | CodeRAG |
|---|---|
| VS Code >= 1.103 on Linux x64/arm64, macOS x64/arm64, Windows x64 (local) | available |
| VS Code 1.101 - 1.102 (Electron 35, SQLite without FTS5) | unavailable: "Needs VS Code 1.103 or newer (this build's SQLite lacks FTS5)" |
| Remote / WSL / container host with Node >= 22.16 | available |
| Remote host with Node <= 22.15 | unavailable: "Needs Node.js 22.16 or newer on the remote host" |
| Node < 22.14 or no `node:sqlite` | unavailable: "Needs VS Code 1.101 or newer (Node.js 22.14+ with node:sqlite)" |
| Windows arm64, Alpine / musl | unavailable (no sqlite-vec build; the reason names the failing module) |

The check (about a quarter of a second, so it is not done at activation) runs the first time CodeRAG is started in a
session and its result is kept for the session. Until then CodeRAG is listed as stopped; on a host that cannot run it,
the first start attempt turns it into *unavailable* with the reason above, it disappears from the MCP servers list of
VS Code, and Git keeps working. The Git server
works on every host from VS Code 1.101. On Node 22 and Electron up to 37 the runtime prints an "SQLite is an
experimental feature" warning to stderr; it is harmless. CodeRAG runs in the extension host process: indexing is
batched and yields between files, but a very large repository (tens of thousands of chunks) makes searches slower, and a
native crash would take the extension host down with it.

## Token model

All servers of a workspace share **one bearer token**. It is generated once (`crypto.randomBytes(32)`, 64 hex
characters), kept in VS Code Secret Storage (the authoritative copy) and mirrored to
`<globalStorage>/tokens/<scope>.json` as `{"token": "..."}` with mode `0600` inside a `0700` directory, written
atomically (temporary file, then rename; on Windows POSIX modes are best effort and the file relies on the profile's
ACL). If the secret is missing but the file holds a valid token (for example after migrating the machine) the file's
token is adopted. The token never appears in settings, logs, URLs, notifications or `.mcp.json`.

`<scope>` is the first 16 hex characters of the SHA-256 of the sorted `file:` workspace folder URIs: the same folder
set gives the same token in every window and after every restart; **adding or removing a folder changes the scope and
therefore the token** (servers restart with the new one, and `.mcp.json` entries written earlier point at the old scope
until you run "Add to Claude Code" again). Ports are fixed by settings, so URLs stay stable too. `MCP Servers: Rotate
Server Token` is the only other way the token changes.

## VS Code MCP servers

On VS Code 1.101+ the extension registers an MCP server definition provider ("MCP Servers (this workspace)"). Every
available server appears in VS Code's MCP servers list as `MCP Servers: Git` / `MCP Servers: CodeRAG`, so you can switch
it on there: VS Code starts the server on demand and receives the `Authorization: Bearer ...` header only at that
moment. Servers that cannot run on this host (CodeRAG on VS Code 1.101-1.102) are not listed.

## Claude Code

Claude Code cannot discover servers registered by a VS Code extension, so `MCP Servers: Add to Claude Code...` writes
what it needs. After you pick servers it offers:

- **Write `.mcp.json`** in the first workspace folder: entries `vscode-git` / `vscode-coderag` of the form
  `{"type": "http", "url": "http://127.0.0.1:<port>/mcp", "headersHelper": "node '<helper>' '<scope>' --dir '<tokens dir>'"}`
  are merged into an existing file (other servers and keys are kept; an invalid file is refused and left untouched).
  A confirmation warns that the file contains a machine-specific path and offers to add `.mcp.json` to
  `.git/info/exclude` (only in a git repository, only on your consent).
- **Copy `claude mcp add-json` command(s)** (local scope) with the same JSON.
- **Copy client config (JSON)** as `{"mcpServers": {...}}`.

The token is never written. The `headersHelper` runs `dist/mcp-headers.js`, a dependency-free script that the extension
copies to `<globalStorage>/bin/mcp-headers.js` at activation (a path without the extension version, so entries survive
upgrades). It prints `{"Authorization":"Bearer <token>"}` read from the `0600` file, or exits with code 1 and a message
on stderr (without any token) - this is also how a stale entry shows itself (wrong scope after a folder change, or no
VS Code window open on that workspace). Quoting is for the platform VS Code runs on (POSIX single quotes; Windows double
quotes with forward slashes). Claude Code needs the servers to be running; start them first.

## Security notes

- Servers bind to `127.0.0.1` only and refuse requests without the bearer token (constant-time comparison); a
  non-loopback `Origin` header is rejected.
- Settings that widen file access or redirect data - `allowedRoots`, `docsInclude`, `codeInclude` and `embeddingUrl` -
  are **machine scoped**: a repository's `.vscode/settings.json` cannot set them. Ports and the remaining CodeRAG
  settings can be set per workspace; a hostile value can at worst make a server fail to start or index less or more of
  the workspace folders.
- The embeddings API key lives in Secret Storage and is passed to CodeRAG in memory; it is not a setting and is never
  logged or shown.
- The token lives in Secret Storage and in one `0600` file under the extension's global storage; do not copy that
  directory. Anyone who can read your user profile can use the servers.
- CodeRAG confines all file-reading and file-writing tools to the workspace folders, the include-pattern bases and
  `allowedRoots`, with symlinks resolved.

## Supported platforms

One VSIX per target: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` (about 21 MB each, almost
all of it tree-sitter grammars). Requires VS Code 1.101 or later.

## Building

From the repository root (`pnpm install` first):

```sh
pnpm --filter ./packages/vscode-extension run build            # bundle: dist/extension.js
pnpm --filter ./packages/vscode-extension run stage:native     # native modules for this machine into dist/native
pnpm --filter ./packages/vscode-extension run package -- --target linux-x64 --out /path/to/out
```

`package` builds, stages the natives for the target and runs `vsce package --no-dependencies --target <target>`.
Staging another platform's natives needs that platform's `sqlite-vec-<os>-<arch>` package in the pnpm store (see
`supportedArchitectures` in the pnpm documentation); otherwise package on a machine of that platform.

Tests: `pnpm --filter ./packages/vscode-extension run test`. Set `VSCODE_TEST_BINARIES` to a `@vscode/test-electron` cache
directory to also run the bundle under real VS Code builds (`ELECTRON_RUN_AS_NODE=1`).

## License

MIT
