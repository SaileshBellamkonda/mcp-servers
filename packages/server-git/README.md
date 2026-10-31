# Git MCP Server

Git operations for MCP clients, restricted to repositories you list. Part of the
[mcp-servers](../../README.md) monorepo.

- **30 tools** for status, history, branches, staging, commits, worktrees, remotes, stash, tags, merge, rebase and more.
- **Two modes from one code base:** standalone (stdio or Streamable HTTP) and embedded in the
  [VS Code extension](../vscode-extension/README.md) (HTTP on `127.0.0.1`, bearer token required).
- **Restricted by design:** an allow-list of repositories, path validation, git argument validation and an allow-listed
  git environment (see [Security](#security)).

## Requirements

- Node.js 22 or later (`engines.node` is `>=22.0.0`).
- `git` on `PATH`; a git command that runs longer than 30 seconds is stopped.

## Usage

Build from the repository root (`pnpm install && pnpm build`), then run the bundle in `dist/`. After installing the
package its `bin` is `git-mcp-server`.

### Standalone, stdio (default)

```bash
GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2" node dist/standalone.js
```

### Standalone, HTTP

```bash
export MCP_AUTH_TOKEN="<at least 32 characters>"
MCP_TRANSPORT=http GIT_ALLOWED_REPOS="/path/to/repo" node dist/standalone.js
```

The endpoint is `http://127.0.0.1:3000/mcp`; clients send `Authorization: Bearer <token>`. See
[HTTP security](../../README.md#http-security-model) for what the host enforces.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GIT_ALLOWED_REPOS` | required | `;`-separated list of repository paths the tools may operate on. The process exits when it is unset or empty |
| `MCP_TRANSPORT` | `stdio` | `http` selects the HTTP transport |
| `MCP_HTTP_HOST` | `127.0.0.1` | Interface to bind. A non-loopback value requires `MCP_AUTH_TOKEN` |
| `MCP_HTTP_PORT` | `3000` | TCP port (`0` picks a free port) |
| `MCP_AUTH_TOKEN` | unset | Bearer token, at least 32 characters. Never passed on to git |
| `GIT_PUSH_ALLOWED_BRANCHES` | unset | `;`-separated list of branches `git_push` may push; `*` allows all. Unset means no restriction |
| `GIT_ALLOW_REMOTE_URLS` | off | `1`/`true`/`yes`/`on` lets `git_fetch`, `git_pull` and `git_push` take a URL or path as the remote instead of only the name of a configured remote |
| `LOG_LEVEL` | `info` | Lowest level written to `LOG_FILE`: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert` or `emergency`. `debug` also logs every git command |
| `LOG_FILE` | unset | File to append log entries to; unset means no log file |
| `GIT_COMMIT_NAME`, `GIT_COMMIT_EMAIL` | unset | When either is set, `git_commit` commits with `-c user.name=... -c user.email=...` (the unset one becomes empty) instead of the repository's identity |

### Logging

Nothing is written to stderr. Set `LOG_FILE` to get a log: each entry at or above `LOG_LEVEL` is appended as
`<ISO time> [LEVEL] [component] message`. Without `LOG_FILE` the server keeps no log of its own (MCP clients still
receive log notifications, filtered by their `logging/setLevel`). Missing directories are created, the file is
created with mode `0600`, and an invalid `LOG_LEVEL` makes the process exit with a message on stderr. Tool failures are logged at `error` level.

```sh
LOG_FILE=/var/log/mcp/git.log LOG_LEVEL=debug GIT_ALLOWED_REPOS="/path/to/repo" node dist/standalone.js
```


### Embedded mode (VS Code extension)

```typescript
import { activateGitServer } from '@mcp-servers/server-git/embedded';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  // authToken is required (>= 32 characters); clients send it as `Authorization: Bearer <token>`.
  const instance = await activateGitServer({ workspaceFolders, port: 3000, authToken });
  context.subscriptions.push({ dispose: () => { void instance.close(); } });
}
```

`activateGitServer({ workspaceFolders, port?, authToken, logger? })` rejects an empty folder list and a missing or short
token, always binds `127.0.0.1` (port defaults to 3000, `0` picks a free one) and resolves to
`{ port, host, close(), updateAllowedRepositories(folders) }`.

## Tools

Repository and status
- `git_workspaces`, `git_status`, `git_log`, `git_show`, `git_diff`, `git_blame`, `git_reflog`, `git_search`,
  `git_file_history`

Branches, tags and history changes
- `git_branch`, `git_tag`, `git_merge`, `git_rebase`, `git_cherry_pick`, `git_stash`

Staging and committing
- `git_add`, `git_commit`

Remotes
- `git_remote_list`, `git_remote_add`, `git_remote_remove`, `git_fetch`, `git_pull`, `git_push`

Worktrees
- `git_worktree_list`, `git_worktree_add`, `git_worktree_remove`, `git_worktree_prune`, `git_worktree_move`,
  `git_worktree_lock`, `git_worktree_unlock`

## Security

- **Repository allow-list:** every tool names a repository that must be in `GIT_ALLOWED_REPOS` (embedded: the workspace
  folders), otherwise the call is refused.
- **Path validation:** file paths may not contain a `..` segment, start with `~` or point into system directories, must
  stay inside the repository, and are checked with symlinks resolved.
- **No shell:** git is started with an argument array (`execFile`), never through a shell.
- **Option and pathspec injection:** refs, branches, remotes, tags, targets and pathspecs may not start with `-` or
  contain control characters; branch names may not be refspecs; `git_add` takes explicit file paths only (no wildcards,
  no `:` pathspec magic, no repository root) and runs `git --literal-pathspecs add --`; revisions are passed after
  `--end-of-options` where git supports it.
- **Remotes:** `git_fetch`, `git_pull` and `git_push` accept only the name of a configured remote, so
  `GIT_PUSH_ALLOWED_BRANCHES` cannot be bypassed by pushing to a URL. Set `GIT_ALLOW_REMOTE_URLS=1` to also allow URLs
  and paths; `ext::`-style remote-helper transports are refused either way.
- **Environment:** git runs with an allow-listed environment (`PATH`, `HOME`, locale, proxy and SSH-agent variables and
  similar), so server secrets such as `MCP_AUTH_TOKEN` never reach git, hooks or credential helpers. It also sets
  `GIT_TERMINAL_PROMPT=0` and `GIT_ALLOW_PROTOCOL=file:git:http:https:ssh`.
- **HTTP:** loopback bind by default, bearer token required for any other host and always in embedded mode; see the
  [root README](../../README.md#http-security-model).

Known limit: a repository's own `.git/config` (for example `core.fsmonitor` or `core.sshCommand`) is honoured by git, so
only allow repositories you trust.

## Development

From the repository root:

```bash
pnpm --filter @mcp-servers/server-git run build          # esbuild bundle + declarations
pnpm --filter @mcp-servers/server-git run test
pnpm --filter @mcp-servers/server-git run test:coverage  # thresholds: 85 % lines, functions, branches, statements
pnpm --filter @mcp-servers/server-git run typecheck
pnpm --filter @mcp-servers/server-git run dev            # standalone entry from source (tsx)
pnpm lint                                                # ESLint for the whole repository
```

The build inlines the private `@mcp-servers/common` and `@mcp-servers/http-host` packages into `dist/standalone.js` and
`dist/embedded.js`; third-party dependencies stay external.

## License

MIT
