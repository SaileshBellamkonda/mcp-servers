# Git MCP Server Design Specification

**Date:** 2026-04-22  
**Status:** Approved  
**Version:** 1.0  
**Author:** Development Team

---

## Executive Summary

The Git MCP Server is a Model Context Protocol (MCP) server that provides safe, controlled access to Git operations through a standardized interface. It is designed with dual-mode operation capability, functioning both as a standalone MCP server and as an embedded component within Visual Studio Code extensions.

The server exposes 14 MCP tools covering essential Git operations including repository status, commit history, branching, staging, committing, and worktree management. Security is paramount, with comprehensive path validation, command injection prevention, and repository access controls.

**Key Features:**
- **Dual-mode operation:** Standalone (stdio) and embedded (HTTP) modes
- **Security-first design:** Path validation, input sanitization, command injection prevention
- **Type-safe implementation:** Full TypeScript with strict mode
- **Comprehensive Git operations:** 14 tools covering core Git workflows
- **Worktree support:** Full worktree lifecycle management
- **Structured output:** Parsed data for programmatic consumption

---

## Architecture Overview

### Package Structure

```
packages/server-git/
├── src/
│   ├── core/                    # Core business logic (mode-agnostic)
│   │   ├── repository-manager.ts    # Manage allowed repositories
│   │   ├── path-validator.ts        # Path validation and security
│   │   ├── git-executor.ts          # Safe Git command execution
│   │   └── output-parser.ts         # Parse Git command output
│   ├── tools/                   # MCP tool implementations
│   │   ├── git-workspaces.ts        # List allowed repositories
│   │   ├── git-status.ts            # Repository status
│   │   ├── git-log.ts               # Commit history
│   │   ├── git-branch.ts            # Branch operations
│   │   ├── git-diff.ts              # Show changes
│   │   ├── git-add.ts               # Stage files
│   │   ├── git-commit.ts            # Commit changes
│   │   └── worktree/                # Worktree operations
│   │       ├── git-worktree-list.ts
│   │       ├── git-worktree-add.ts
│   │       ├── git-worktree-remove.ts
│   │       ├── git-worktree-prune.ts
│   │       ├── git-worktree-move.ts
│   │       ├── git-worktree-lock.ts
│   │       └── git-worktree-unlock.ts
│   ├── server/                  # MCP server setup
│   │   └── git-server.ts            # Server configuration and tool registration
│   ├── standalone.ts            # Standalone entry point (stdio)
│   └── embedded.ts              # Embedded entry point (HTTP)
├── tests/
│   ├── unit/                    # Unit tests
│   │   ├── core/
│   │   └── tools/
│   ├── integration/             # Integration tests
│   └── fixtures/                # Test fixtures (mock repos)
├── package.json
├── tsconfig.json
└── README.md
```

### Layered Architecture

The server follows a clean layered architecture:

1. **Core Layer** (`src/core/`): Mode-agnostic business logic
   - Repository management and access control
   - Path validation and security
   - Git command execution
   - Output parsing

2. **Tools Layer** (`src/tools/`): MCP tool implementations
   - Each tool is a separate module
   - Tools use core layer services
   - Input validation and error handling
   - Structured output formatting

3. **Server Layer** (`src/server/`): MCP server setup
   - Tool registration
   - Server configuration
   - Mode-agnostic server logic

4. **Entry Points** (`src/standalone.ts`, `src/embedded.ts`): Mode-specific initialization
   - Transport configuration
   - Environment-specific setup
   - Server instantiation

### Key Design Principles

1. **Dual-mode operation:** Core logic is transport-agnostic, enabling both standalone and embedded modes
2. **Security-first:** All inputs validated, paths checked, commands sanitized
3. **Type-safe:** Full TypeScript with strict mode enabled
4. **Testable:** Clear separation of concerns, dependency injection
5. **MCP compliant:** Follows MCP specification for tools and resources

---

## Core Layer Design

### Repository Manager

**Purpose:** Manage the list of allowed repositories and provide access control.

**Responsibilities:**
- Load allowed repositories from environment (standalone) or VS Code workspace (embedded)
- Validate repository paths exist and are Git repositories
- Provide repository lookup and validation

**Interface:**

```typescript
interface RepositoryManager {
  /**
   * Get all allowed repository paths
   */
  getAllowedRepositories(): string[];
  
  /**
   * Check if a repository path is allowed
   */
  isRepositoryAllowed(repoPath: string): boolean;
  
  /**
   * Validate and normalize a repository path
   * @throws Error if repository is not allowed
   */
  validateRepository(repoPath: string): string;
  
  /**
   * Update the list of allowed repositories (for dynamic configuration)
   */
  updateAllowedRepositories(repos: string[]): void;
}
```

**Configuration:**
- **Standalone mode:** Read from `GIT_ALLOWED_REPOS` environment variable (semicolon-separated paths)
- **Embedded mode:** Use VS Code workspace folders

**Example:**
```typescript
// Standalone
process.env.GIT_ALLOWED_REPOS = "C:/projects/repo1;C:/projects/repo2";

// Embedded
const workspaceFolders = vscode.workspace.workspaceFolders;
const allowedRepos = workspaceFolders.map(f => f.uri.fsPath);
```

### Path Validator

**Purpose:** Validate and sanitize file paths to prevent security vulnerabilities.

**Responsibilities:**
- Prevent path traversal attacks (reject `..`, `~`, absolute paths outside allowed repos)
- Normalize paths (resolve relative paths, handle Windows/Unix differences)
- Ensure paths are within allowed repositories
- Validate file/directory existence when required

**Interface:**

```typescript
interface PathValidator {
  /**
   * Validate a path is safe and within an allowed repository
   * @throws Error if path is invalid or unsafe
   */
  validatePath(repoPath: string, filePath: string): string;
  
  /**
   * Validate multiple paths
   * @throws Error if any path is invalid
   */
  validatePaths(repoPath: string, filePaths: string[]): string[];
  
  /**
   * Check if a path contains dangerous patterns
   */
  isSafePath(path: string): boolean;
}
```

**Validation Rules:**
- Reject paths containing `..` (parent directory traversal)
- Reject paths starting with `~` (home directory expansion)
- Reject absolute paths that are outside allowed repositories
- Normalize path separators (handle both `/` and `\`)
- Resolve relative paths against repository root

**Example:**
```typescript
// Valid
validatePath("/repo", "src/file.ts") // → "/repo/src/file.ts"
validatePath("/repo", "./src/file.ts") // → "/repo/src/file.ts"

// Invalid
validatePath("/repo", "../outside") // → throws Error
validatePath("/repo", "~/file") // → throws Error
validatePath("/repo", "/etc/passwd") // → throws Error
```

### Git Executor

**Purpose:** Execute Git commands safely with timeout protection and error handling.

**Responsibilities:**
- Execute Git commands using `child_process.spawn` (not shell strings)
- Apply timeout protection (default 30 seconds)
- Capture stdout, stderr, and exit codes
- Handle command failures gracefully

**Interface:**

```typescript
interface GitExecutor {
  /**
   * Execute a Git command
   * @param repoPath Repository path
   * @param args Git command arguments (e.g., ['status', '--porcelain'])
   * @param options Execution options
   * @returns Command output
   */
  execute(
    repoPath: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<GitCommandResult>;
}

interface ExecuteOptions {
  timeout?: number; // milliseconds, default 30000
  input?: string; // stdin input
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}
```

**Security Features:**
- Use `spawn` with argument array (prevents shell injection)
- Never concatenate user input into shell strings
- Apply timeout to prevent hanging processes
- Validate repository path before execution

**Example:**
```typescript
// Safe execution
await executor.execute("/repo", ["status", "--porcelain"]);
await executor.execute("/repo", ["add", "file1.ts", "file2.ts"]);

// NOT this (vulnerable to injection)
// exec(`git add ${userInput}`); // NEVER DO THIS
```

### Output Parser

**Purpose:** Parse Git command output into structured data for programmatic consumption.

**Responsibilities:**
- Parse `git status --porcelain` into structured file status
- Parse `git log` into commit objects
- Parse `git branch` into branch list
- Parse `git worktree list` into worktree objects
- Return raw text for `git diff` (preserve formatting)

**Interface:**

```typescript
interface OutputParser {
  parseStatus(output: string): FileStatus[];
  parseLog(output: string): Commit[];
  parseBranches(output: string): Branch[];
  parseWorktrees(output: string): Worktree[];
}

interface FileStatus {
  path: string;
  status: string; // e.g., "M", "A", "D", "??", "MM"
  staged: boolean;
  unstaged: boolean;
}

interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
}

interface Worktree {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
  prunable: boolean;
}
```

**Parsing Examples:**

```typescript
// git status --porcelain
// " M file.ts" → { path: "file.ts", status: "M", staged: false, unstaged: true }
// "M  file.ts" → { path: "file.ts", status: "M", staged: true, unstaged: false }
// "MM file.ts" → { path: "file.ts", status: "MM", staged: true, unstaged: true }

// git log --format="%H|%an|%ad|%s"
// "abc123|John|2024-01-01|Initial commit" → { hash: "abc123", author: "John", ... }

// git branch -a
// "* main" → { name: "main", current: true, remote: false }
// "  feature" → { name: "feature", current: false, remote: false }
// "  remotes/origin/main" → { name: "origin/main", current: false, remote: true }
```

---

## MCP Tools Design

All tools follow the MCP specification and return structured responses. Each tool includes input validation, error handling, and security checks.

### Tool 1: git_workspaces

**Purpose:** List all allowed Git repositories.

**Parameters:** None

**Output Format:**
```json
{
  "repositories": [
    {
      "path": "/path/to/repo1",
      "name": "repo1"
    },
    {
      "path": "/path/to/repo2",
      "name": "repo2"
    }
  ]
}
```

**Validation:** None required (no user input)

---

### Tool 2: git_status

**Purpose:** Get the current status of a Git repository.

**Parameters:**
- `repository` (required): Repository path (must be in allowed list)

**Output Format:**
```json
{
  "branch": "main",
  "ahead": 0,
  "behind": 0,
  "files": [
    {
      "path": "src/file.ts",
      "status": "M",
      "staged": false,
      "unstaged": true
    }
  ]
}
```

**Validation:**
- Repository must be in allowed list
- Repository must exist and be a valid Git repository

**Git Command:** `git status --porcelain --branch`

---

### Tool 3: git_log

**Purpose:** Get commit history for a repository.

**Parameters:**
- `repository` (required): Repository path
- `limit` (optional): Maximum number of commits (default: 10, max: 100)
- `branch` (optional): Branch name (default: current branch)

**Output Format:**
```json
{
  "commits": [
    {
      "hash": "abc123...",
      "author": "John Doe",
      "date": "2024-01-01T12:00:00Z",
      "message": "Initial commit"
    }
  ]
}
```

**Validation:**
- Repository must be in allowed list
- Limit must be between 1 and 100
- Branch name must be valid (alphanumeric, `-`, `_`, `/`)

**Git Command:** `git log --format="%H|%an|%ad|%s" -n <limit> <branch>`

---

### Tool 4: git_branch

**Purpose:** List branches in a repository.

**Parameters:**
- `repository` (required): Repository path
- `all` (optional): Include remote branches (default: false)

**Output Format:**
```json
{
  "branches": [
    {
      "name": "main",
      "current": true,
      "remote": false
    },
    {
      "name": "feature/new",
      "current": false,
      "remote": false
    },
    {
      "name": "origin/main",
      "current": false,
      "remote": true
    }
  ]
}
```

**Validation:**
- Repository must be in allowed list

**Git Command:** `git branch` or `git branch -a`

---

### Tool 5: git_diff

**Purpose:** Show changes in the repository.

**Parameters:**
- `repository` (required): Repository path
- `target` (optional): Diff target (file path, commit hash, or branch name)
- `staged` (optional): Show staged changes only (default: false)

**Output Format:**
```json
{
  "diff": "diff --git a/file.ts b/file.ts\nindex abc123..def456 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line\n existing line"
}
```

**Validation:**
- Repository must be in allowed list
- If target is a file path, validate it's within repository
- If target is a commit/branch, validate format

**Git Command:** 
- `git diff` (unstaged changes)
- `git diff --staged` (staged changes)
- `git diff <target>` (specific file/commit)

---

### Tool 6: git_add

**Purpose:** Stage files for commit.

**Parameters:**
- `repository` (required): Repository path
- `files` (required): Array of file paths to stage

**Output Format:**
```json
{
  "success": true,
  "staged": ["src/file1.ts", "src/file2.ts"]
}
```

**Validation:**
- Repository must be in allowed list
- Files array must not be empty
- Each file path must be validated (no `..`, no absolute paths outside repo)
- **CRITICAL:** Reject `.` or `-A` patterns (must specify explicit files)
- Files must exist in repository

**Security Note:** This is a high-risk operation. Never allow staging all files with wildcards or patterns. Users must explicitly list each file.

**Git Command:** `git add <file1> <file2> ...`

---

### Tool 7: git_commit

**Purpose:** Commit staged changes.

**Parameters:**
- `repository` (required): Repository path
- `message` (required): Commit message

**Output Format:**
```json
{
  "success": true,
  "commit": "abc123...",
  "message": "feat: add new feature"
}
```

**Validation:**
- Repository must be in allowed list
- Message must not be empty
- Message must be sanitized (no shell metacharacters)
- Message length should be reasonable (max 500 characters)

**Git Command:** `git commit -m "<message>"`

---

### Tool 8: git_worktree_list

**Purpose:** List all worktrees in a repository.

**Parameters:**
- `repository` (required): Repository path

**Output Format:**
```json
{
  "worktrees": [
    {
      "path": "/path/to/main",
      "branch": "main",
      "commit": "abc123...",
      "locked": false,
      "prunable": false
    },
    {
      "path": "/path/to/feature",
      "branch": "feature/new",
      "commit": "def456...",
      "locked": false,
      "prunable": false
    }
  ]
}
```

**Validation:**
- Repository must be in allowed list

**Git Command:** `git worktree list --porcelain`

---

### Tool 9: git_worktree_add

**Purpose:** Create a new worktree.

**Parameters:**
- `repository` (required): Repository path
- `path` (required): Path for new worktree (absolute path or relative to repository root)
- `branch` (optional): Branch name (creates new branch if doesn't exist)
- `commitish` (optional): Commit-ish reference to checkout (commit hash, branch name, tag, or tree-ish like HEAD~1)

**Output Format:**
```json
{
  "success": true,
  "path": "/path/to/new-worktree",
  "branch": "feature/new"
}
```

**Validation:**
- Repository must be in allowed list
- Path must be validated:
  - If absolute: must be within allowed directories (not system directories)
  - If relative: resolved against repository root, no `..` traversal
  - Must not already exist
- Branch name must be valid (alphanumeric, `-`, `_`, `/`)
- Commitish must match Git ref format if provided: alphanumeric, `-`, `_`, `/`, `~`, `^`, or valid commit hash (40 hex chars)

**Git Command:** `git worktree add <path> <branch>`

---

### Tool 10: git_worktree_remove

**Purpose:** Remove a worktree.

**Parameters:**
- `repository` (required): Repository path
- `path` (required): Worktree path to remove
- `force` (optional): Force removal even with uncommitted changes (default: false)

**Output Format:**
```json
{
  "success": true,
  "removed": "/path/to/worktree"
}
```

**Validation:**
- Repository must be in allowed list
- Path must be validated
- Worktree must exist
- Cannot remove main worktree (the worktree at the repository root containing the `.git` directory, not a `.git` file)

**Git Command:** `git worktree remove <path>` or `git worktree remove --force <path>`

---

### Tool 11: git_worktree_prune

**Purpose:** Prune stale worktree administrative files.

**Parameters:**
- `repository` (required): Repository path
- `dry_run` (optional): Show what would be pruned without actually pruning (default: false)

**Output Format:**
```json
{
  "success": true,
  "pruned": ["/path/to/stale-worktree"]
}
```

**Validation:**
- Repository must be in allowed list

**Git Command:** `git worktree prune` or `git worktree prune --dry-run`

---

### Tool 12: git_worktree_move

**Purpose:** Move a worktree to a new location.

**Parameters:**
- `repository` (required): Repository path
- `source` (required): Current worktree path
- `destination` (required): New worktree path

**Output Format:**
```json
{
  "success": true,
  "from": "/path/to/old",
  "to": "/path/to/new"
}
```

**Validation:**
- Repository must be in allowed list
- Source path must be validated and exist
- Destination path must be validated and not exist
- Cannot move main worktree (the worktree at the repository root containing the `.git` directory)

**Git Command:** `git worktree move <source> <destination>`

---

### Tool 13: git_worktree_lock

**Purpose:** Lock a worktree to prevent removal.

**Parameters:**
- `repository` (required): Repository path
- `path` (required): Worktree path to lock
- `reason` (optional): Reason for locking

**Output Format:**
```json
{
  "success": true,
  "locked": "/path/to/worktree",
  "reason": "In use by CI"
}
```

**Validation:**
- Repository must be in allowed list
- Path must be validated and exist
- If worktree is already locked, return success (idempotent operation) with existing lock reason

**Git Command:** `git worktree lock <path>` or `git worktree lock --reason "<reason>" <path>`

---

### Tool 14: git_worktree_unlock

**Purpose:** Unlock a worktree to allow removal.

**Parameters:**
- `repository` (required): Repository path
- `path` (required): Worktree path to unlock

**Output Format:**
```json
{
  "success": true,
  "unlocked": "/path/to/worktree"
}
```

**Validation:**
- Repository must be in allowed list
- Path must be validated and exist
- Worktree must be locked

**Git Command:** `git worktree unlock <path>`

---

## Security & Error Handling

### Path Validation

**Threat Model:**
- Path traversal attacks (`../../../etc/passwd`)
- Access to files outside allowed repositories
- Symbolic link exploitation
- Home directory expansion (`~/sensitive`)

**Mitigation Strategies:**

1. **Reject dangerous patterns:**
   ```typescript
   const DANGEROUS_PATTERNS = [
     /\.\./,           // Parent directory
     /^~/,             // Home directory
     /^\/etc\//,       // System directories
     /^\/root\//,
     /^\/sys\//,
     /^\/proc\//,
   ];
   ```

2. **Normalize and resolve paths:**
   ```typescript
   import path from 'path';
   
   function normalizePath(repoPath: string, filePath: string): string {
     const resolved = path.resolve(repoPath, filePath);
     if (!resolved.startsWith(repoPath)) {
       throw new Error('Path outside repository');
     }
     return resolved;
   }
   ```

3. **Validate against allowed repositories:**
   ```typescript
   function validateRepository(repoPath: string): void {
     const allowed = repositoryManager.getAllowedRepositories();
     if (!allowed.includes(repoPath)) {
       throw new Error('Repository not allowed');
     }
   }
   ```

### Input Sanitization

**Branch Names:**
- Allow: alphanumeric, `-`, `_`, `/`
- Reject: spaces, special characters, shell metacharacters

```typescript
function validateBranchName(name: string): void {
  if (!/^[a-zA-Z0-9/_-]+$/.test(name)) {
    throw new Error('Invalid branch name');
  }
}
```

**Commit Messages:**
- Escape shell metacharacters
- Limit length (max 500 characters)
- Reject control characters

```typescript
function sanitizeCommitMessage(message: string): string {
  if (message.length > 500) {
    throw new Error('Commit message too long');
  }
  // Remove control characters
  return message.replace(/[\x00-\x1F\x7F]/g, '');
}
```

**File Paths:**
- Must be relative to repository root
- No wildcards or glob patterns in `git add`
- Each file explicitly validated

### Command Injection Prevention

**NEVER use shell strings:**
```typescript
// ❌ VULNERABLE
exec(`git add ${userInput}`);

// ✅ SAFE
spawn('git', ['add', userInput]);
```

**Use spawn with argument arrays:**
```typescript
import { spawn } from 'child_process';

function executeGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: repoPath,
      timeout: 30000,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data);
    proc.stderr.on('data', (data) => stderr += data);
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: ${stderr}`));
      }
    });
  });
}
```

### Worktree-Specific Security

**Additional Considerations:**
- Validate worktree paths are within allowed directories
- Prevent creation of worktrees in sensitive locations
- Ensure worktree operations don't escape repository boundaries
- Lock worktrees during critical operations

### Error Categories

**1. Validation Errors (400-level):**
- Invalid parameters
- Path validation failures
- Repository not allowed

```typescript
class ValidationError extends Error {
  code = 'VALIDATION_ERROR';
  statusCode = 400;
}
```

**2. Git Errors (500-level):**
- Git command failures
- Repository not found
- Merge conflicts

```typescript
class GitError extends Error {
  code = 'GIT_ERROR';
  statusCode = 500;
  gitOutput?: string;
}
```

**3. Security Errors (403-level):**
- Path traversal attempts
- Unauthorized repository access

```typescript
class SecurityError extends Error {
  code = 'SECURITY_ERROR';
  statusCode = 403;
}
```

### Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid file path: contains '..'",
    "details": {
      "path": "../etc/passwd",
      "reason": "Path traversal attempt"
    }
  }
}
```

### Error Recovery Strategies

1. **Timeout errors:** Retry with exponential backoff (max 3 attempts)
2. **Lock conflicts:** Wait and retry (max 5 seconds)
3. **Validation errors:** Return immediately with clear message
4. **Git errors:** Include Git output in error details for debugging

---

## Dual-Mode Operation

The Git MCP Server is designed to operate in two distinct modes with shared core logic.

### Standalone Mode

**Transport:** stdio (Standard Input/Output)

**Configuration:**
- Allowed repositories from `GIT_ALLOWED_REPOS` environment variable
- Semicolon-separated list of absolute paths
- Example: `GIT_ALLOWED_REPOS="C:/projects/repo1;C:/projects/repo2"`

**Entry Point:** `src/standalone.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';

async function main() {
  // Parse allowed repositories from environment
  const allowedRepos = process.env.GIT_ALLOWED_REPOS?.split(';') || [];
  
  if (allowedRepos.length === 0) {
    console.error('Error: GIT_ALLOWED_REPOS environment variable not set');
    process.exit(1);
  }
  
  // Create repository manager
  const repoManager = new RepositoryManager(allowedRepos);
  
  // Create MCP server
  const server = new Server(
    {
      name: 'git-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Register tools
  createGitServer(server, repoManager);
  
  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('Git MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Usage:**
```bash
# Set allowed repositories
export GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2"

# Run server
node dist/standalone.js
```

### Embedded Mode

**Transport:** Streamable HTTP (Web Standards compliant streaming)

**Configuration:**
- Allowed repositories from VS Code workspace folders
- Port from extension settings (default: 3000)
- Automatic workspace folder detection

**Entry Point:** `src/embedded.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamable-http.js';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';
import * as vscode from 'vscode';

export async function activateGitServer(
  context: vscode.ExtensionContext,
  port: number = 3000
): Promise<void> {
  // Get workspace folders
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const allowedRepos = workspaceFolders.map(f => f.uri.fsPath);
  
  if (allowedRepos.length === 0) {
    vscode.window.showWarningMessage('No workspace folders found for Git MCP Server');
    return;
  }
  
  // Create repository manager
  const repoManager = new RepositoryManager(allowedRepos);
  
  // Create MCP server
  const server = new Server(
    {
      name: 'git-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Register tools
  createGitServer(server, repoManager);
  
  // Create Streamable HTTP transport
  const transport = new StreamableHTTPServerTransport({
    port,
    path: '/mcp',
  });
  
  await server.connect(transport);
  
  console.log(`Git MCP Server running on port ${port}`);
  
  // Register for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      // Update allowed repositories
      const newRepos = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
      repoManager.updateAllowedRepositories(newRepos);
    })
  );
}
```

**VS Code Extension Integration:**
```typescript
// extension.ts
import * as vscode from 'vscode';
import { activateGitServer } from '@mcp-servers/server-git/embedded';

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('gitMcpServer');
  const port = config.get<number>('port', 3000);
  
  await activateGitServer(context, port);
}
```

### Shared Server Logic

The core server setup is mode-agnostic and reusable:

**`src/server/git-server.ts`:**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RepositoryManager } from '../core/repository-manager.js';
import { PathValidator } from '../core/path-validator.js';
import { GitExecutor } from '../core/git-executor.js';
import { OutputParser } from '../core/output-parser.js';

// Import all tools
import { registerGitWorkspaces } from '../tools/git-workspaces.js';
import { registerGitStatus } from '../tools/git-status.js';
import { registerGitLog } from '../tools/git-log.js';
// ... import other tools

export function createGitServer(
  server: Server,
  repoManager: RepositoryManager
): void {
  // Create core services
  const pathValidator = new PathValidator(repoManager);
  const gitExecutor = new GitExecutor();
  const outputParser = new OutputParser();
  
  const services = {
    repoManager,
    pathValidator,
    gitExecutor,
    outputParser,
  };
  
  // Register all tools
  registerGitWorkspaces(server, services);
  registerGitStatus(server, services);
  registerGitLog(server, services);
  registerGitBranch(server, services);
  registerGitDiff(server, services);
  registerGitAdd(server, services);
  registerGitCommit(server, services);
  registerGitWorktreeList(server, services);
  registerGitWorktreeAdd(server, services);
  registerGitWorktreeRemove(server, services);
  registerGitWorktreePrune(server, services);
  registerGitWorktreeMove(server, services);
  registerGitWorktreeLock(server, services);
  registerGitWorktreeUnlock(server, services);
}
```

### Mode Comparison

| Aspect | Standalone | Embedded |
|--------|-----------|----------|
| **Transport** | stdio | Streamable HTTP |
| **Repository Config** | Environment variable | VS Code workspace folders |
| **Deployment** | Separate process | Within VS Code extension |
| **Use Case** | CLI tools, external clients | VS Code extensions |
| **Configuration** | `GIT_ALLOWED_REPOS` env var | Extension settings |

---

## Testing Strategy

### Unit Tests

**Location:** `tests/unit/`

**Coverage:**
- Core layer: 90% minimum
- Tools layer: 85% minimum

**Test Structure:**

```typescript
// tests/unit/core/path-validator.test.ts
import { describe, it, expect } from 'vitest';
import { PathValidator } from '../../../src/core/path-validator';

describe('PathValidator', () => {
  describe('validatePath', () => {
    it('should accept valid relative paths', () => {
      const validator = new PathValidator(mockRepoManager);
      const result = validator.validatePath('/repo', 'src/file.ts');
      expect(result).toBe('/repo/src/file.ts');
    });
    
    it('should reject parent directory traversal', () => {
      const validator = new PathValidator(mockRepoManager);
      expect(() => {
        validator.validatePath('/repo', '../outside');
      }).toThrow('Path traversal');
    });
    
    it('should reject home directory expansion', () => {
      const validator = new PathValidator(mockRepoManager);
      expect(() => {
        validator.validatePath('/repo', '~/file');
      }).toThrow('Invalid path');
    });
  });
});
```

**Test Categories:**
1. **Path validation:** All security rules
2. **Git execution:** Command building, timeout, error handling
3. **Output parsing:** All Git command formats
4. **Repository management:** Access control, validation

### Integration Tests

**Location:** `tests/integration/`

**Coverage:** 80% minimum

**Test Structure:**

```typescript
// tests/integration/git-workflow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRepository } from '../fixtures/test-repo';

describe('Git Workflow', () => {
  let testRepo: TestRepository;
  
  beforeEach(async () => {
    testRepo = await createTestRepository();
  });
  
  afterEach(async () => {
    await testRepo.cleanup();
  });
  
  it('should complete full commit workflow', async () => {
    // Create file
    await testRepo.writeFile('test.ts', 'content');
    
    // Check status
    const status = await gitStatus(testRepo.path);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].status).toBe('??');
    
    // Stage file
    await gitAdd(testRepo.path, ['test.ts']);
    
    // Commit
    const result = await gitCommit(testRepo.path, 'test: add file');
    expect(result.success).toBe(true);
    
    // Verify log
    const log = await gitLog(testRepo.path, { limit: 1 });
    expect(log.commits[0].message).toBe('test: add file');
  });
});
```

**Test Scenarios:**
1. **Basic workflows:** status → add → commit
2. **Branch operations:** create, switch, list
3. **Worktree lifecycle:** add → use → remove
4. **Error handling:** invalid paths, Git errors
5. **Security:** path traversal attempts, injection attempts

### Test Fixtures

**Location:** `tests/fixtures/`

**Mock Repository:**

```typescript
// tests/fixtures/test-repo.ts
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class TestRepository {
  constructor(public path: string) {}
  
  static async create(): Promise<TestRepository> {
    const path = await mkdtemp(join(tmpdir(), 'git-test-'));
    await execAsync('git init', { cwd: path });
    await execAsync('git config user.name "Test"', { cwd: path });
    await execAsync('git config user.email "test@example.com"', { cwd: path });
    return new TestRepository(path);
  }
  
  async writeFile(name: string, content: string): Promise<void> {
    await writeFile(join(this.path, name), content);
  }
  
  async cleanup(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
```

### Coverage Goals

| Component | Target Coverage |
|-----------|----------------|
| Core layer | 90% |
| Tools layer | 85% |
| Server setup | 80% |
| **Overall** | **85%** |

**Coverage Commands:**
```bash
# Run tests with coverage
pnpm test --coverage

# View coverage report
pnpm coverage:report
```

---

## Implementation Summary

### Package Information

**Name:** `@mcp-servers/server-git`  
**Version:** 1.0.0  
**License:** MIT

### Dependencies

**Core:**
- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `typescript` - Type-safe development
- `zod` - Runtime type validation

**Development:**
- `vitest` - Testing framework
- `@types/node` - Node.js type definitions
- `tsx` - TypeScript execution

**Optional (Embedded Mode):**
- `vscode` - VS Code extension API

### Key Features

1. **14 MCP Tools** covering essential Git operations
2. **Dual-mode operation** (standalone + embedded)
3. **Security-first design** with comprehensive validation
4. **Type-safe implementation** with TypeScript strict mode
5. **Comprehensive testing** with 85% coverage goal
6. **Worktree support** for advanced Git workflows
7. **Structured output** for programmatic consumption
8. **Error handling** with clear, actionable messages

### Development Workflow

1. **Design** → Use brainstorming skill
2. **Plan** → Use writing-plans skill
3. **Implement** → TDD with test-driven-development skill
4. **Verify** → Use verification-before-completion skill
5. **Review** → Use requesting-code-review skill

### Success Criteria

- [ ] All 14 tools implemented and tested
- [ ] 85% overall test coverage achieved
- [ ] Security validation passes all tests
- [ ] Both standalone and embedded modes functional
- [ ] Documentation complete (README, API docs)
- [ ] No critical security vulnerabilities
- [ ] Performance: commands complete within 30s timeout
- [ ] Error messages are clear and actionable

---

## Appendix

### MCP Tool Registration Example

```typescript
// tools/git-status.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';

const GitStatusSchema = z.object({
  repository: z.string().describe('Repository path'),
});

export function registerGitStatus(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_status',
    description: 'Get the current status of a Git repository',
    inputSchema: GitStatusSchema,
    handler: async (input) => {
      const { repository } = GitStatusSchema.parse(input);
      
      // Validate repository
      services.repoManager.validateRepository(repository);
      
      // Execute git status
      const result = await services.gitExecutor.execute(
        repository,
        ['status', '--porcelain', '--branch']
      );
      
      // Parse output
      const status = services.outputParser.parseStatus(result.stdout);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    },
  });
}
```

### Environment Variable Configuration

**Standalone Mode:**
```bash
# Windows (cmd.exe)
set GIT_ALLOWED_REPOS=C:\projects\repo1;C:\projects\repo2

# Windows (PowerShell)
$env:GIT_ALLOWED_REPOS="C:\projects\repo1;C:\projects\repo2"

# Unix/Linux/macOS
export GIT_ALLOWED_REPOS="/home/user/repo1;/home/user/repo2"
```

### VS Code Extension Settings

**`package.json` (extension):**
```json
{
  "contributes": {
    "configuration": {
      "title": "Git MCP Server",
      "properties": {
        "gitMcpServer.port": {
          "type": "number",
          "default": 3000,
          "description": "Port for Git MCP Server"
        },
        "gitMcpServer.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable Git MCP Server"
        }
      }
    }
  }
}
```

---

**End of Specification**
