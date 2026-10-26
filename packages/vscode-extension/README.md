# MCP Servers for VS Code

Runs [Model Context Protocol](https://modelcontextprotocol.io/) servers inside the VS Code extension host, so
MCP clients can use them without a separate process.

- **Git** - safe, controlled Git operations on the repositories of your workspace folders.
- **CodeRAG** - semantic search over code and Markdown through an OpenAI-compatible embeddings endpoint
  (added to the extension in a later release; see availability below).

Every server listens on `127.0.0.1` only and requires a bearer token. The tree view and status bar show the
state of each server; the commands `MCP Servers: Start/Stop/Restart Server` control them.

## Settings

| Setting | Default | |
|---|---|---|
| `mcpServers.git.autoStart` | `true` | Start the Git server when the workspace opens |
| `mcpServers.git.port` | `3000` | Port of the Git server |

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
