# MCP Servers for VS Code

Runs [Model Context Protocol](https://modelcontextprotocol.io/) servers inside the VS Code extension host, so
MCP clients can use them without a separate process.

- **Git** - safe, controlled Git operations on the repositories of your workspace folders.
- **CodeRAG** - semantic search over code and Markdown through an OpenAI-compatible embeddings endpoint
  (added to the extension in a later release; see availability below).

Every server listens on `127.0.0.1` only and requires a bearer token (random per VS Code session; it is never shown
or copied). The **MCP Servers** view in the activity bar and the status bar entry show the state of each server
(stopped, starting, running, error, or unavailable with the reason); the status bar counts the running servers.

## Behaviour

- **Auto-start:** with `mcpServers.git.autoStart` on, the Git server starts when VS Code opens with a workspace folder,
  and when you open a folder later. Without a folder the server is *unavailable* ("Open a folder to use the Git server").
- **Workspace folders:** adding or removing folders re-scopes the running Git server without a restart; closing the last
  folder stops it.
- **Port:** changing `mcpServers.git.port` restarts a running server and tells you. A taken port is reported as
  "Port N is already in use (change mcpServers.git.port)"; any other startup failure shows its real message once.
- **Shutdown:** all servers are stopped when the extension deactivates, so no port stays bound.

## Commands

Available from the Command Palette (category *MCP Servers*), as inline buttons on a tree item and in its context menu.
From the palette with several candidates you pick the server; with exactly one it is used directly.

| Command | |
|---|---|
| `MCP Servers: Start Server` | Start a stopped (or failed) server |
| `MCP Servers: Stop Server` | Stop a running server |
| `MCP Servers: Restart Server` | Restart a running server (keeps its token) |
| `MCP Servers: Copy Server URL` | Copies `http://127.0.0.1:<port>/mcp` (never the token) |

## Settings

| Setting | Default | |
|---|---|---|
| `mcpServers.git.autoStart` | `true` | Start the Git server when a workspace folder is open |
| `mcpServers.git.port` | `3000` | Port of the Git server (`0` picks a free port) |

## CodeRAG availability

CodeRAG needs `node:sqlite` with FTS5, the sqlite-vec extension and tree-sitter, so it is enabled only where all
of them load and is reported as unavailable (with the reason) elsewhere.

| Host | CodeRAG |
|---|---|
| VS Code >= 1.103 on Linux x64/arm64, macOS x64/arm64, Windows x64 | available |
| VS Code 1.101 - 1.102 (Electron 35, SQLite without FTS5) | unavailable |
| Remote / WSL host with Node >= 22.16 | available |
| Remote host with Node <= 22.15 | unavailable |
| Windows arm64, Alpine / musl | unavailable (no sqlite-vec build) |

The Git server works on every host from VS Code 1.101.

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
