# MCP Servers for VS Code

Runs [Model Context Protocol](https://modelcontextprotocol.io/) servers inside the VS Code extension host, so
MCP clients can use them without a separate process. Part of the [mcp-servers monorepo](../../README.md); the same servers also run standalone.

- **Git** - safe, controlled Git operations on the repositories of your workspace folders.
- **CodeRAG** - semantic search over code and Markdown through an OpenAI-compatible embeddings endpoint. It runs inside
  the extension host and only where the runtime supports it (see [CodeRAG availability](#coderag-availability)).

Every server listens on `127.0.0.1` only and requires its own bearer token (derived from one stable secret per
workspace, see [Token model](#token-model); it is never shown or copied). The extension works only in trusted,
non-virtual workspaces (see [Workspace trust](#workspace-trust)). The **MCP Servers** view in the activity bar and the status
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
- **Several windows:** if another VS Code window on the same workspace rotates the token (or two windows race the first
  run), this window's running servers restart with the stored token after a short pause and say so, so they keep
  accepting the helper's token.
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
| `MCP Servers: Add to Claude Code...` | Pick among the running servers, then write `.mcp.json`, copy `claude mcp add-json` commands, or copy a client config (see [Claude Code](#claude-code)) |
| `MCP Servers: Rotate Server Token` | Replaces the workspace token and with it every server's token (asks first; restarts running servers) |
| `MCP Servers: Set CodeRAG API Key` | Stores the embeddings API key in VS Code Secret Storage (masked input) |
| `MCP Servers: Clear CodeRAG API Key` | Removes it; a running CodeRAG restarts without it |

## Settings

| Setting | Default | |
|---|---|---|
| `mcpServers.git.autoStart` | `true` | Start the Git server when a workspace folder is open |
| `mcpServers.git.port` | `3000` | Port of the Git server (`0` picks a free port) |
| `mcpServers.coderag.autoStart` | `false` | Start CodeRAG when a workspace folder is open (indexing costs CPU, disk and embedding requests) |
| `mcpServers.coderag.port` | `3100` | Port of the CodeRAG server (`0` picks a free port) |
| `mcpServers.coderag.watch` | `true` | Re-index files as they change in the workspace folders; turn it off if watching a very large folder strains the system |
| `mcpServers.coderag.toolset` | `standard` | Tools CodeRAG offers: `search`, `standard` (search, search_relations, get_index_status, sync_documents) or `all` (11 tools; their definitions cost about 1.1k more tokens per session) |
| `mcpServers.coderag.embeddingUrl` | *(required)* | Base URL of the OpenAI-compatible embeddings endpoint, e.g. `http://localhost:11434/v1`. **Machine scoped** |
| `mcpServers.coderag.embeddingModel` | *(required)* | Embedding model name, e.g. `nomic-embed-text` |
| `mcpServers.coderag.embedMaxChars` | `6000` | Longest text sent to the embedding endpoint for one chunk or query, in characters; longer chunks are cut for embedding only (`0` disables the limit) |
| `mcpServers.coderag.embeddingDim` | `768` | Vector dimensions; must match the model. Used only when the workspace database is created: an existing database keeps its stored dimensions (a different value only logs a warning) |
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

Each workspace has **one secret**, from which every server's own bearer token is derived:
`serverToken = HMAC-SHA256(key = workspace secret, data = "mcp-servers:<serverId>")` as 64 hex characters (`git`,
`coderag`). A process that squats one server's port and receives that server's token from a client therefore cannot use
it against another server, and the workspace secret itself is never sent to a server or printed.

The secret is generated once (`crypto.randomBytes(32)`, 64 hex characters), kept in VS Code Secret Storage (the
authoritative copy; when two windows race to create it, both adopt the stored value) and mirrored to
`<globalStorage>/tokens/<scope>.json` as `{"token": "..."}` with mode `0600` inside a `0700` directory, written
atomically (temporary file, then rename; on Windows POSIX modes are best effort and the file relies on the profile's
ACL). If the secret is missing but the file holds a valid token (for example after migrating the machine) the file's
token is adopted. Neither the secret nor a server token appears in settings, logs, URLs, notifications or `.mcp.json`.

`<scope>` is the first 16 hex characters of the SHA-256 of the sorted `file:` workspace folder URIs: the same folder
set gives the same tokens in every window and after every restart; **adding or removing a folder changes the scope and
therefore the tokens** (servers restart with the new ones, and `.mcp.json` entries written earlier point at the old
scope until you run "Add to Claude Code" again). Ports are fixed by settings, so URLs stay stable too. `MCP Servers:
Rotate Server Token` is the only other way the tokens change.

## VS Code MCP servers

On VS Code 1.101+ the extension registers an MCP server definition provider ("MCP Servers (this workspace)"). Every
available server appears in VS Code's MCP servers list as `MCP Servers: Git` / `MCP Servers: CodeRAG`, so you can switch
it on there: VS Code starts the server on demand and receives the `Authorization: Bearer ...` header only at that
moment. Servers that cannot run on this host (CodeRAG on VS Code 1.101-1.102) are not listed.

## Claude Code

Claude Code cannot discover servers registered by a VS Code extension, so `MCP Servers: Add to Claude Code...` writes
what it needs. After you pick servers it offers:

- **Write `.mcp.json`** in the first workspace folder: entries `vscode-git` / `vscode-coderag` of the form
  `{"type": "http", "url": "http://127.0.0.1:<port>/mcp", "headersHelper": "node '<helper>' '<scope>' '<serverId>' --dir '<tokens dir>'"}`
  are merged into an existing file (other servers and keys are kept; an invalid file is refused and left untouched).
  An existing `vscode-*` entry is **replaced** (the confirmation lists it), which is how entries written by an older
  version, whose helper command lacks the server id, get fixed. A confirmation warns that the file contains a
  machine-specific path and offers to add `.mcp.json` to `.git/info/exclude` (only in a git repository with a real
  `.git` directory, only on your consent). A symbolic link at `.mcp.json`, `.git`, `.git/info` or `.git/info/exclude` is
  refused with an error and never written through; files are written through a temporary file and a rename.
- **Copy `claude mcp add-json` command(s)** (local scope) with the same JSON.
- **Copy client config (JSON)** as `{"mcpServers": {...}}`.

Only servers that are **running** (with a fixed port) are offered; for the others the message says what to do, and with
none running it offers to show the MCP Servers view. No token is ever written. The `headersHelper` runs
`dist/mcp-headers.js`, a dependency-free script that the extension copies to `<globalStorage>/bin/mcp-headers.js` at
activation (a path without the extension version, so entries survive upgrades). Its command line is

    node mcp-headers.js <scopeKey> <serverId> [--dir <tokens directory>]

(`MCP_SERVERS_TOKENS_DIR` can replace `--dir`; `<serverId>` is `^[a-z][a-z0-9-]{0,31}$`). It reads the workspace secret
from the `0600` file, derives that server's token and prints `{"Authorization":"Bearer <server token>"}`, or exits
with code 1 and a message on stderr (without any token) - this is also how a stale entry shows itself (wrong scope after
a folder change, no VS Code window open on that workspace, or an entry from an older version that lacks the server id).
Quoting is for the platform VS Code runs on (POSIX single quotes; Windows double quotes with forward slashes).
The command starts with a bare `node`, so **`node` must be on the `PATH` of the client** (the extension host's own
binary is VS Code, not Node, so it cannot be used). The Windows quoting is covered by unit tests only, not by a test
on a Windows machine.

## Security notes

- Servers bind to `127.0.0.1` only and refuse requests without the bearer token (constant-time comparison); a
  non-loopback `Origin` header is rejected.
- Settings that widen file access or redirect data - `allowedRoots`, `docsInclude`, `codeInclude` and `embeddingUrl` -
  are **machine scoped**: a repository's `.vscode/settings.json` cannot set them. Ports and the remaining CodeRAG
  settings can be set per workspace; a hostile value can at worst make a server fail to start or index less or more of
  the workspace folders.
- The embeddings API key lives in Secret Storage and is passed to CodeRAG in memory; it is not a setting and is never
  logged or shown.
- The workspace secret lives in Secret Storage and in one `0600` file under the extension's global storage; do not copy
  that directory. Anyone who can read your user profile can use the servers. Directories the extension creates for
  the CodeRAG index (workspace storage) and the helper (`bin`) get mode `0700`; ones that already existed keep theirs.
- CodeRAG confines all file-reading and file-writing tools to the workspace folders, the include-pattern bases and
  `allowedRoots`, with symlinks resolved.

## Workspace trust

The manifest declares `untrustedWorkspaces` and `virtualWorkspaces` as **not supported**: in Restricted Mode the
extension is disabled, and it does not run on virtual file systems. The servers read and run what a workspace contains
(git repositories and their configuration, files to index, workspace settings), so they should only run in a workspace
you trust.

## Supported platforms

One VSIX per target: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` (about 21 MB each, almost
all of it tree-sitter grammars). Requires VS Code 1.101 or later.

## Building

From the repository root (`pnpm install` first):

```sh
pnpm --filter ./packages/vscode-extension run build            # bundle: dist/extension.js
pnpm --filter ./packages/vscode-extension run stage:native     # native modules for this machine into dist/native
pnpm --filter ./packages/vscode-extension run package --target linux-x64 --out /path/to/out
```

`package` builds, stages the natives for the target and runs `vsce package --no-dependencies --target <target>`.
Staging another platform's natives needs that platform's `sqlite-vec-<os>-<arch>` package in the pnpm store (see
`supportedArchitectures` in the pnpm documentation); otherwise package on a machine of that platform.

Tests: `pnpm --filter ./packages/vscode-extension run test`. Set `VSCODE_TEST_BINARIES` to a `@vscode/test-electron` cache
directory to also run the bundle under real VS Code builds (`ELECTRON_RUN_AS_NODE=1`).

## License

MIT
