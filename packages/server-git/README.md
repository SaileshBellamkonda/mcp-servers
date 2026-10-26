# Git MCP Server

Safe, controlled Git operations via Model Context Protocol (MCP).

## Features

- **14 Git Tools**: Status, log, branch, diff, add, commit, and full worktree support
- **Dual-Mode Operation**: Standalone (stdio) and embedded (HTTP) modes
- **Security-First**: Path validation, command injection prevention, repository access control
- **Type-Safe**: Full TypeScript with strict mode
- **Well-Tested**: 85%+ test coverage

## Installation

```bash
pnpm install @mcp-servers/server-git
```

## Usage

### Standalone Mode (stdio)

```bash
# Set allowed repositories
export GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2"

# Run server
npx git-mcp-server
```

### Embedded Mode (VS Code Extension)

```typescript
import { activateGitServer } from '@mcp-servers/server-git/embedded';

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
  // authToken is required (>= 32 characters); clients send it as `Authorization: Bearer <token>`.
  const instance = await activateGitServer({ workspaceFolders, port: 3000, authToken });
  context.subscriptions.push({ dispose: () => { void instance.close(); } });
}
```

## Available Tools

### Repository Management
- `git_workspaces` - List allowed repositories

### Status & History
- `git_status` - Get repository status
- `git_log` - View commit history
- `git_branch` - List branches
- `git_diff` - Show changes

### Staging & Committing
- `git_add` - Stage files
- `git_commit` - Commit changes

### Worktree Operations
- `git_worktree_list` - List worktrees
- `git_worktree_add` - Create worktree
- `git_worktree_remove` - Remove worktree
- `git_worktree_prune` - Prune stale worktrees
- `git_worktree_move` - Move worktree
- `git_worktree_lock` - Lock worktree
- `git_worktree_unlock` - Unlock worktree

## Security

- All file paths validated (no `..`, `~`, or absolute paths outside repos)
- Command injection prevention (uses `spawn` with argument arrays)
- Repository access control (only allowed repos accessible)
- Input sanitization (commit messages, branch names)
- Explicit file staging (no wildcards or patterns)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Test with coverage
pnpm test:coverage

# Lint
pnpm lint
```

## License

MIT