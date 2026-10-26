# @mcp-servers/common

Small helpers shared by the servers in this repository. **Private** (`"private": true`, never published): the server
packages and the VS Code extension inline it at build time with esbuild.

## API

Exported from the package root (`src/index.ts`).

| Export | Description |
|---|---|
| `parsePort(value, defaultPort)` | Parses a TCP port. Blank or `undefined` gives the default; an integer from 0 to 65535 is accepted (`0` asks the OS for a free port); anything else throws an `Error` naming the value |
| `parseList(value, defaultValue = [])` | Splits on `;`, trims entries and drops empty ones. When nothing remains it returns a copy of `defaultValue` |
| `parseBool(value, defaultValue)` | `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off`, case-insensitive. Unset, blank or unrecognised values give the default |
| `McpLogger` | `new McpLogger(server, name)` with `debug`, `info`, `notice`, `warning`, `error` and `critical`. Each call writes `[LEVEL] [name] message` to stderr and sends an MCP logging notification (fire and forget) through the given `McpServer` |

Blank environment values (`FOO=`) behave like unset ones in all three parsers.

## Development

```sh
pnpm --filter @mcp-servers/common run build
pnpm --filter @mcp-servers/common run test
pnpm --filter @mcp-servers/common run typecheck
```

The package exports a `@mcp-servers/source` condition that points at `src/index.ts`; workspace consumers use it for
type checking, tests and bundling, so no build is needed during development. Coverage thresholds are 85 %.
