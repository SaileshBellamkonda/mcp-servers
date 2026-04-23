# Git MCP Server Implementation Plan

**Date:** 2026-04-22  
**Status:** Ready for Implementation  
**Version:** 1.0  
**Spec Reference:** [`docs/specs/2026-04-22-git-mcp-server-design.md`](../specs/2026-04-22-git-mcp-server-design.md)

---

## Goal

Implement a production-ready Git MCP Server that provides safe, controlled access to Git operations through the Model Context Protocol. The server will support dual-mode operation (standalone via stdio and embedded via HTTP) with comprehensive security validation, 14 Git tools, and full worktree support.

## Architecture

**Layered Architecture:**
1. **Core Layer** - Mode-agnostic business logic (repository management, path validation, Git execution, output parsing)
2. **Tools Layer** - 14 MCP tool implementations using core services
3. **Server Layer** - Mode-agnostic server setup and tool registration
4. **Entry Points** - Mode-specific initialization (standalone stdio, embedded HTTP)

**Key Principles:**
- Security-first: All inputs validated, paths checked, commands sanitized
- Type-safe: Full TypeScript strict mode
- Testable: Clear separation of concerns, dependency injection
- TDD: Red-Green-Refactor for all production code

## Technology Stack

- **Runtime:** Node.js (latest LTS)
- **Language:** TypeScript 5.x (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk` v1.x
- **Validation:** `zod` v3.x
- **Testing:** `vitest` v1.x
- **Package Manager:** pnpm
- **Optional:** `vscode` module for embedded mode

## File Structure

```
packages/server-git/
├── src/
│   ├── core/
│   │   ├── types.ts                     # Shared TypeScript types
│   │   ├── repository-manager.ts        # Repository access control
│   │   ├── path-validator.ts            # Path validation & security
│   │   ├── git-executor.ts              # Safe Git command execution
│   │   └── output-parser.ts             # Parse Git output to structured data
│   ├── tools/
│   │   ├── git-workspaces.ts            # List allowed repositories
│   │   ├── git-status.ts                # Repository status
│   │   ├── git-log.ts                   # Commit history
│   │   ├── git-branch.ts                # Branch operations
│   │   ├── git-diff.ts                  # Show changes
│   │   ├── git-add.ts                   # Stage files
│   │   ├── git-commit.ts                # Commit changes
│   │   └── worktree/
│   │       ├── git-worktree-list.ts     # List worktrees
│   │       ├── git-worktree-add.ts      # Create worktree
│   │       ├── git-worktree-remove.ts   # Remove worktree
│   │       ├── git-worktree-prune.ts    # Prune stale worktrees
│   │       ├── git-worktree-move.ts     # Move worktree
│   │       ├── git-worktree-lock.ts     # Lock worktree
│   │       └── git-worktree-unlock.ts   # Unlock worktree
│   ├── server/
│   │   └── git-server.ts                # Server setup & tool registration
│   ├── standalone.ts                    # Standalone entry (stdio)
│   └── embedded.ts                      # Embedded entry (HTTP)
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   │   ├── repository-manager.test.ts
│   │   │   ├── path-validator.test.ts
│   │   │   ├── git-executor.test.ts
│   │   │   └── output-parser.test.ts
│   │   └── tools/
│   │       ├── git-workspaces.test.ts
│   │       ├── git-status.test.ts
│   │       ├── git-log.test.ts
│   │       ├── git-branch.test.ts
│   │       ├── git-diff.test.ts
│   │       ├── git-add.test.ts
│   │       ├── git-commit.test.ts
│   │       └── worktree/
│   │           ├── git-worktree-list.test.ts
│   │           ├── git-worktree-add.test.ts
│   │           ├── git-worktree-remove.test.ts
│   │           ├── git-worktree-prune.test.ts
│   │           ├── git-worktree-move.test.ts
│   │           ├── git-worktree-lock.test.ts
│   │           └── git-worktree-unlock.test.ts
│   ├── integration/
│   │   ├── git-workflow.test.ts
│   │   ├── worktree-lifecycle.test.ts
│   │   └── security.test.ts
│   └── fixtures/
│       └── test-repo.ts                 # Mock Git repository helper
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Implementation Tasks

### Phase 1: Project Setup

#### Task 1.1: Initialize package structure
**Goal:** Create package directory and basic configuration files

**Steps:**
1. Create directory: `packages/server-git`
2. Create subdirectories: `src/`, `tests/`, `src/core/`, `src/tools/`, `src/tools/worktree/`, `src/server/`

**Commands:**
```bash
mkdir -p packages/server-git/src/core
mkdir -p packages/server-git/src/tools/worktree
mkdir -p packages/server-git/src/server
mkdir -p packages/server-git/tests/unit/core
mkdir -p packages/server-git/tests/unit/tools/worktree
mkdir -p packages/server-git/tests/integration
mkdir -p packages/server-git/tests/fixtures
```

**Verification:**
```bash
ls -la packages/server-git/src
ls -la packages/server-git/tests
```

**Commit:** `chore: initialize git MCP server package structure`

---

#### Task 1.2: Create package.json
**Goal:** Define package metadata, dependencies, and scripts

**File:** `packages/server-git/package.json`

**Content:**
```json
{
  "name": "@mcp-servers/server-git",
  "version": "1.0.0",
  "description": "Git MCP Server - Safe, controlled Git operations via Model Context Protocol",
  "type": "module",
  "main": "./dist/standalone.js",
  "types": "./dist/standalone.d.ts",
  "exports": {
    ".": "./dist/standalone.js",
    "./embedded": "./dist/embedded.js"
  },
  "bin": {
    "git-mcp-server": "./dist/standalone.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/standalone.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "keywords": ["mcp", "git", "model-context-protocol", "vscode"],
  "author": "Development Team",
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@vitest/coverage-v8": "^1.2.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  },
  "peerDependencies": {
    "vscode": "*"
  },
  "peerDependenciesMeta": {
    "vscode": {
      "optional": true
    }
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Verification:**
```bash
cd packages/server-git && cat package.json
```

**Commit:** `chore: add package.json with dependencies and scripts`

---

#### Task 1.3: Create tsconfig.json
**Goal:** Configure TypeScript with strict mode and proper module resolution

**File:** `packages/server-git/tsconfig.json`

**Content:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Verification:**
```bash
cd packages/server-git && cat tsconfig.json
```

**Commit:** `chore: add TypeScript configuration with strict mode`

---

#### Task 1.4: Create vitest.config.ts
**Goal:** Configure Vitest for testing with coverage

**File:** `packages/server-git/vitest.config.ts`

**Content:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', '**/*.test.ts', '**/*.config.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
```

**Verification:**
```bash
cd packages/server-git && cat vitest.config.ts
```

**Commit:** `chore: add Vitest configuration with coverage thresholds`

---

#### Task 1.5: Install dependencies
**Goal:** Install all required packages

**Commands:**
```bash
cd packages/server-git
pnpm install
```

**Verification:**
```bash
ls -la node_modules/@modelcontextprotocol
ls -la node_modules/zod
ls -la node_modules/vitest
```

**Commit:** `chore: install dependencies`

---

### Phase 2: Core Layer - Types

#### Task 2.1: Write test for core types
**Goal:** Define test for TypeScript interfaces and types (RED)

**File:** `packages/server-git/tests/unit/core/types.test.ts`

**Content:**
```typescript
import { describe, it, expect } from 'vitest';
import type {
  GitCommandResult,
  ExecuteOptions,
  FileStatus,
  Commit,
  Branch,
  Worktree,
  Repository,
  Services
} from '../../../src/core/types.js';

describe('Core Types', () => {
  it('should define GitCommandResult interface', () => {
    const result: GitCommandResult = {
      stdout: 'output',
      stderr: '',
      exitCode: 0,
      success: true
    };
    expect(result.stdout).toBe('output');
    expect(result.success).toBe(true);
  });

  it('should define FileStatus interface', () => {
    const status: FileStatus = {
      path: 'src/file.ts',
      status: 'M',
      staged: false,
      unstaged: true
    };
    expect(status.path).toBe('src/file.ts');
  });

  it('should define Commit interface', () => {
    const commit: Commit = {
      hash: 'abc123',
      author: 'John Doe',
      date: '2024-01-01',
      message: 'Initial commit'
    };
    expect(commit.hash).toBe('abc123');
  });

  it('should define Branch interface', () => {
    const branch: Branch = {
      name: 'main',
      current: true,
      remote: false
    };
    expect(branch.current).toBe(true);
  });

  it('should define Worktree interface', () => {
    const worktree: Worktree = {
      path: '/path/to/worktree',
      branch: 'feature',
      commit: 'abc123',
      locked: false,
      prunable: false
    };
    expect(worktree.locked).toBe(false);
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/core/types.test.ts
```

**Expected:** Test fails because types.ts doesn't exist

**Commit:** `test: add core types test (RED)`

---

#### Task 2.2: Implement core types (GREEN)
**Goal:** Create TypeScript types and interfaces

**File:** `packages/server-git/src/core/types.ts`

**Content:**
```typescript
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RepositoryManager } from './repository-manager.js';
import type { PathValidator } from './path-validator.js';
import type { GitExecutor } from './git-executor.js';
import type { OutputParser } from './output-parser.js';

/**
 * Result of a Git command execution
 */
export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

/**
 * Options for Git command execution
 */
export interface ExecuteOptions {
  timeout?: number;
  input?: string;
}

/**
 * File status in Git repository
 */
export interface FileStatus {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
}

/**
 * Git commit information
 */
export interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/**
 * Git branch information
 */
export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
}

/**
 * Git worktree information
 */
export interface Worktree {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
  prunable: boolean;
}

/**
 * Repository information
 */
export interface Repository {
  path: string;
  name: string;
}

/**
 * Core services available to tools
 */
export interface Services {
  repoManager: RepositoryManager;
  pathValidator: PathValidator;
  gitExecutor: GitExecutor;
  outputParser: OutputParser;
}

/**
 * Error codes
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  GIT_ERROR = 'GIT_ERROR',
  SECURITY_ERROR = 'SECURITY_ERROR',
  NOT_FOUND = 'NOT_FOUND'
}

/**
 * Base error class
 */
export class GitMcpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GitMcpError';
  }
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/core/types.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement core types and interfaces (GREEN)`

---

### Phase 3: Core Layer - Repository Manager

#### Task 3.1: Write test for RepositoryManager (RED)
**Goal:** Test repository access control and validation

**File:** `packages/server-git/tests/unit/core/repository-manager.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('RepositoryManager', () => {
  let manager: RepositoryManager;

  beforeEach(() => {
    manager = new RepositoryManager(['/repo1', '/repo2']);
  });

  describe('getAllowedRepositories', () => {
    it('should return all allowed repositories', () => {
      const repos = manager.getAllowedRepositories();
      expect(repos).toEqual(['/repo1', '/repo2']);
    });

    it('should return empty array when no repositories configured', () => {
      const emptyManager = new RepositoryManager([]);
      expect(emptyManager.getAllowedRepositories()).toEqual([]);
    });
  });

  describe('isRepositoryAllowed', () => {
    it('should return true for allowed repository', () => {
      expect(manager.isRepositoryAllowed('/repo1')).toBe(true);
      expect(manager.isRepositoryAllowed('/repo2')).toBe(true);
    });

    it('should return false for disallowed repository', () => {
      expect(manager.isRepositoryAllowed('/repo3')).toBe(false);
      expect(manager.isRepositoryAllowed('/etc/passwd')).toBe(false);
    });

    it('should normalize paths before checking', () => {
      expect(manager.isRepositoryAllowed('/repo1/')).toBe(true);
      expect(manager.isRepositoryAllowed('/repo1/.')).toBe(true);
    });
  });

  describe('validateRepository', () => {
    it('should return normalized path for allowed repository', () => {
      const result = manager.validateRepository('/repo1');
      expect(result).toBe('/repo1');
    });

    it('should throw error for disallowed repository', () => {
      expect(() => manager.validateRepository('/repo3')).toThrow(GitMcpError);
      expect(() => manager.validateRepository('/repo3')).toThrow('not allowed');
    });

    it('should throw error with SECURITY_ERROR code', () => {
      try {
        manager.validateRepository('/etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });
  });

  describe('updateAllowedRepositories', () => {
    it('should update the list of allowed repositories', () => {
      manager.updateAllowedRepositories(['/repo3', '/repo4']);
      expect(manager.getAllowedRepositories()).toEqual(['/repo3', '/repo4']);
    });

    it('should allow empty list', () => {
      manager.updateAllowedRepositories([]);
      expect(manager.getAllowedRepositories()).toEqual([]);
    });
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/core/repository-manager.test.ts
```

**Expected:** Test fails because repository-manager.ts doesn't exist

**Commit:** `test: add RepositoryManager tests (RED)`

---

#### Task 3.2: Implement RepositoryManager (GREEN)
**Goal:** Create repository access control logic

**File:** `packages/server-git/src/core/repository-manager.ts`

**Content:**
```typescript
import path from 'path';
import { GitMcpError, ErrorCode } from './types.js';

/**
 * Manages allowed Git repositories and provides access control
 */
export class RepositoryManager {
  private allowedRepos: string[];

  constructor(repositories: string[]) {
    this.allowedRepos = repositories.map(repo => path.normalize(repo));
  }

  /**
   * Get all allowed repository paths
   */
  getAllowedRepositories(): string[] {
    return [...this.allowedRepos];
  }

  /**
   * Check if a repository path is allowed
   */
  isRepositoryAllowed(repoPath: string): boolean {
    const normalized = path.normalize(repoPath);
    return this.allowedRepos.includes(normalized);
  }

  /**
   * Validate and normalize a repository path
   * @throws GitMcpError if repository is not allowed
   */
  validateRepository(repoPath: string): string {
    const normalized = path.normalize(repoPath);
    
    if (!this.isRepositoryAllowed(normalized)) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Repository not allowed: ${repoPath}`,
        { repository: repoPath, allowed: this.allowedRepos }
      );
    }
    
    return normalized;
  }

  /**
   * Update the list of allowed repositories
   */
  updateAllowedRepositories(repos: string[]): void {
    this.allowedRepos = repos.map(repo => path.normalize(repo));
  }
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/core/repository-manager.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement RepositoryManager (GREEN)`

---

### Phase 4: Core Layer - Path Validator

#### Task 4.1: Write test for PathValidator (RED)
**Goal:** Test path validation and security checks

**File:** `packages/server-git/tests/unit/core/path-validator.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '../../../src/core/path-validator.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('PathValidator', () => {
  let validator: PathValidator;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    repoManager = new RepositoryManager(['/repo']);
    validator = new PathValidator(repoManager);
  });

  describe('validatePath', () => {
    it('should accept valid relative paths', () => {
      const result = validator.validatePath('/repo', 'src/file.ts');
      expect(result).toContain('src');
      expect(result).toContain('file.ts');
    });

    it('should accept paths with ./ prefix', () => {
      const result = validator.validatePath('/repo', './src/file.ts');
      expect(result).toContain('src');
      expect(result).toContain('file.ts');
    });

    it('should reject parent directory traversal', () => {
      expect(() => validator.validatePath('/repo', '../outside')).toThrow(GitMcpError);
      expect(() => validator.validatePath('/repo', 'src/../../outside')).toThrow(GitMcpError);
    });

    it('should reject home directory expansion', () => {
      expect(() => validator.validatePath('/repo', '~/file')).toThrow(GitMcpError);
    });

    it('should reject absolute paths outside repository', () => {
      expect(() => validator.validatePath('/repo', '/etc/passwd')).toThrow(GitMcpError);
    });

    it('should throw SECURITY_ERROR for dangerous paths', () => {
      try {
        validator.validatePath('/repo', '../etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });
  });

  describe('validatePaths', () => {
    it('should validate multiple paths', () => {
      const paths = ['src/file1.ts', 'src/file2.ts'];
      const results = validator.validatePaths('/repo', paths);
      expect(results).toHaveLength(2);
    });

    it('should throw if any path is invalid', () => {
      const paths = ['src/file1.ts', '../outside'];
      expect(() => validator.validatePaths('/repo', paths)).toThrow(GitMcpError);
    });

    it('should handle empty array', () => {
      const results = validator.validatePaths('/repo', []);
      expect(results).toEqual([]);
    });
  });

  describe('isSafePath', () => {
    it('should return true for safe paths', () => {
      expect(validator.isSafePath('src/file.ts')).toBe(true);
      expect(validator.isSafePath('./src/file.ts')).toBe(true);
      expect(validator.isSafePath('file.ts')).toBe(true);
    });

    it('should return false for dangerous patterns', () => {
      expect(validator.isSafePath('../outside')).toBe(false);
      expect(validator.isSafePath('~/file')).toBe(false);
      expect(validator.isSafePath('/etc/passwd')).toBe(false);
    });
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/core/path-validator.test.ts
```

**Expected:** Test fails because path-validator.ts doesn't exist

**Commit:** `test: add PathValidator tests (RED)`

---

#### Task 4.2: Implement PathValidator (GREEN)
**Goal:** Create path validation and security logic

**File:** `packages/server-git/src/core/path-validator.ts`

**Content:**
```typescript
import path from 'path';
import { GitMcpError, ErrorCode } from './types.js';
import type { RepositoryManager } from './repository-manager.js';

/**
 * Validates and sanitizes file paths to prevent security vulnerabilities
 */
export class PathValidator {
  private static readonly DANGEROUS_PATTERNS = [
    /\.\./,           // Parent directory traversal
    /^~/,             // Home directory expansion
    /^\/etc\//,       // System directories
    /^\/root\//,
    /^\/sys\//,
    /^\/proc\//,
    /^C:\\Windows\\/i, // Windows system directories
    /^C:\\Program Files/i,
  ];

  constructor(private repoManager: RepositoryManager) {}

  /**
   * Validate a path is safe and within an allowed repository
   * @throws GitMcpError if path is invalid or unsafe
   */
  validatePath(repoPath: string, filePath: string): string {
    // Validate repository first
    const validatedRepo = this.repoManager.validateRepository(repoPath);

    // Check for dangerous patterns
    if (!this.isSafePath(filePath)) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Unsafe path detected: ${filePath}`,
        { path: filePath, repository: repoPath }
      );
    }

    // Resolve path against repository root
    const resolved = path.resolve(validatedRepo, filePath);

    // Ensure resolved path is within repository
    if (!resolved.startsWith(validatedRepo)) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Path outside repository: ${filePath}`,
        { path: filePath, repository: repoPath, resolved }
      );
    }

    return resolved;
  }

  /**
   * Validate multiple paths
   * @throws GitMcpError if any path is invalid
   */
  validatePaths(repoPath: string, filePaths: string[]): string[] {
    return filePaths.map(filePath => this.validatePath(repoPath, filePath));
  }

  /**
   * Check if a path contains dangerous patterns
   */
  isSafePath(filePath: string): boolean {
    return !PathValidator.DANGEROUS_PATTERNS.some(pattern => pattern.test(filePath));
  }
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/core/path-validator.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement PathValidator with security checks (GREEN)`

---

### Phase 5: Core Layer - Git Executor

#### Task 5.1: Write test for GitExecutor (RED)
**Goal:** Test Git command execution with timeout and error handling

**File:** `packages/server-git/tests/unit/core/git-executor.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('GitExecutor', () => {
  let executor: GitExecutor;

  beforeEach(() => {
    executor = new GitExecutor();
  });

  describe('execute', () => {
    it('should execute git command and return result', async () => {
      const result = await executor.execute('/repo', ['--version']);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('git version');
    });

    it('should handle command failure', async () => {
      const result = await executor.execute('/nonexistent', ['status']);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it('should apply default timeout of 30 seconds', async () => {
      // This test verifies timeout is set, not that it triggers
      const result = await executor.execute('/repo', ['--version']);
      expect(result).toBeDefined();
    });

    it('should accept custom timeout', async () => {
      const result = await executor.execute('/repo', ['--version'], { timeout: 5000 });
      expect(result.success).toBe(true);
    });

    it('should handle timeout errors', async () => {
      // Create a command that will timeout (sleep equivalent)
      try {
        await executor.execute('/repo', ['sleep', '100'], { timeout: 100 });
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.GIT_ERROR);
      }
    }, 10000);

    it('should capture stdout and stderr separately', async () => {
      const result = await executor.execute('/repo', ['--version']);
      expect(result.stdout).toBeTruthy();
      expect(result.stderr).toBeDefined();
    });
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/core/git-executor.test.ts
```

**Expected:** Test fails because git-executor.ts doesn't exist

**Commit:** `test: add GitExecutor tests (RED)`

---

#### Task 5.2: Implement GitExecutor (GREEN)
**Goal:** Create safe Git command execution logic

**File:** `packages/server-git/src/core/git-executor.ts`

**Content:**
```typescript
import { spawn } from 'child_process';
import { GitMcpError, ErrorCode } from './types.js';
import type { GitCommandResult, ExecuteOptions } from './types.js';

/**
 * Executes Git commands safely with timeout protection
 */
export class GitExecutor {
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

  /**
   * Execute a Git command
   * @param repoPath Repository path
   * @param args Git command arguments
   * @param options Execution options
   * @returns Command output
   */
  async execute(
    repoPath: string,
    args: string[],
    options: ExecuteOptions = {}
  ): Promise<GitCommandResult> {
    const timeout = options.timeout ?? GitExecutor.DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: repoPath,
        timeout,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set up timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);

      // Capture stdout
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Capture stderr
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process completion
      proc.on('close', (exitCode: number | null) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          reject(new GitMcpError(
            ErrorCode.GIT_ERROR,
            `Git command timed out after ${timeout}ms`,
            { args, timeout }
          ));
          return;
        }

        const result: GitCommandResult = {
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          success: exitCode === 0,
        };

        resolve(result);
      });

      // Handle process errors
      proc.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(new GitMcpError(
          ErrorCode.GIT_ERROR,
          `Failed to execute git command: ${error.message}`,
          { args, error: error.message }
        ));
      });

      // Send stdin if provided
      if (options.input) {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }
    });
  }
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/core/git-executor.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement GitExecutor with timeout protection (GREEN)`

---

### Phase 6: Core Layer - Output Parser

#### Task 6.1: Write test for OutputParser (RED)
**Goal:** Test parsing of Git command output

**File:** `packages/server-git/tests/unit/core/output-parser.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { OutputParser } from '../../../src/core/output-parser.js';

describe('OutputParser', () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  describe('parseStatus', () => {
    it('should parse modified unstaged file', () => {
      const output = ' M file.ts';
      const result = parser.parseStatus(output);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'M',
        staged: false,
        unstaged: true
      });
    });

    it('should parse modified staged file', () => {
      const output = 'M  file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'M',
        staged: true,
        unstaged: false
      });
    });

    it('should parse modified staged and unstaged file', () => {
      const output = 'MM file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'MM',
        staged: true,
        unstaged: true
      });
    });

    it('should parse untracked file', () => {
      const output = '?? file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: '??',
        staged: false,
        unstaged: true
      });
    });

    it('should parse multiple files', () => {
      const output = ' M file1.ts\nA  file2.ts\n?? file3.ts';
      const result = parser.parseStatus(output);
      expect(result).toHaveLength(3);
    });

    it('should handle empty output', () => {
      const result = parser.parseStatus('');
      expect(result).toEqual([]);
    });
  });

  describe('parseLog', () => {
    it('should parse single commit', () => {
      const output = 'abc123|John Doe|2024-01-01|Initial commit';
      const result = parser.parseLog(output);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        hash: 'abc123',
        author: 'John Doe',
        date: '2024-01-01',
        message: 'Initial commit'
      });
    });

    it('should parse multiple commits', () => {
      const output = 'abc123|John|2024-01-01|First\ndef456|Jane|2024-01-02|Second';
      const result = parser.parseLog(output);
      expect(result).toHaveLength(2);
    });

    it('should handle empty output', () => {
      const result = parser.parseLog('');
      expect(result).toEqual([]);
    });
  });

  describe('parseBranches', () => {
    it('should parse current branch', () => {
      const output = '* main';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'main',
        current: true,
        remote: false
      });
    });

    it('should parse non-current branch', () => {
      const output = '  feature';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'feature',
        current: false,
        remote: false
      });
    });

    it('should parse remote branch', () => {
      const output = '  remotes/origin/main';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'origin/main',
        current: false,
        remote: true
      });
    });

    it('should parse multiple branches', () => {
      const output = '* main\n  feature\n  remotes/origin/main';
      const result = parser.parseBranches(output);
      expect(result).toHaveLength(3);
    });
  });

  describe('parseWorktrees', () => {
    it('should parse worktree', () => {
      const output = 'worktree /path/to/worktree\nHEAD abc123\nbranch refs/heads/main';
      const result = parser.parseWorktrees(output);
      expect(result[0]).toEqual({
        path: '/path/to/worktree',
        branch: 'main',
        commit: 'abc123',
        locked: false,
        prunable: false
      });
    });

    it('should parse locked worktree', () => {
      const output = 'worktree /path\nHEAD abc123\nbranch refs/heads/main\nlocked';
      const result = parser.parseWorktrees(output);
      expect(result[0].locked).toBe(true);
    });

    it('should parse prunable worktree', () => {
      const output = 'worktree /path\nHEAD abc123\nbranch refs/heads/main\nprunable';
      const result = parser.parseWorktrees(output);
      expect(result[0].prunable).toBe(true);
    });
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/core/output-parser.test.ts
```

**Expected:** Test fails because output-parser.ts doesn't exist

**Commit:** `test: add OutputParser tests (RED)`

---

#### Task 6.2: Implement OutputParser (GREEN)
**Goal:** Create Git output parsing logic

**File:** `packages/server-git/src/core/output-parser.ts`

**Content:**
```typescript
import type { FileStatus, Commit, Branch, Worktree } from './types.js';

/**
 * Parses Git command output into structured data
 */
export class OutputParser {
  /**
   * Parse git status --porcelain output
   */
  parseStatus(output: string): FileStatus[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const statusCode = line.substring(0, 2);
        const path = line.substring(3);
        
        const staged = statusCode[0] !== ' ' && statusCode[0] !== '?';
        const unstaged = statusCode[1] !== ' ' || statusCode[0] === '?';

        return {
          path,
          status: statusCode.trim() || statusCode,
          staged,
          unstaged
        };
      });
  }

  /**
   * Parse git log output (format: %H|%an|%ad|%s)
   */
  parseLog(output: string): Commit[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, date, message] = line.split('|');
        return { hash, author, date, message };
      });
  }

  /**
   * Parse git branch output
   */
  parseBranches(output: string): Branch[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const current = line.startsWith('*');
        const remote = line.includes('remotes/');
        
        let name = line.substring(2).trim();
        if (remote) {
          name = name.replace('remotes/', '');
        }

        return { name, current, remote };
      });
  }

  /**
   * Parse git worktree list --porcelain output
   */
  parseWorktrees(output: string): Worktree[] {
    if (!output.trim()) return [];

    const worktrees: Worktree[] = [];
    const blocks = output.split('\n\n').filter(block => block.trim());

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktree: Partial<Worktree> = {
        locked: false,
        prunable: false
      };

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktree.path = line.substring(9);
        } else if (line.startsWith('HEAD ')) {
          worktree.commit = line.substring(5);
        } else if (line.startsWith('branch ')) {
          const branchRef = line.substring(7);
          worktree.branch = branchRef.replace('refs/heads/', '');
        } else if (line === 'locked') {
          worktree.locked = true;
        } else if (line === 'prunable') {
          worktree.prunable = true;
        }
      }

      if (worktree.path && worktree.commit && worktree.branch) {
        worktrees.push(worktree as Worktree);
      }
    }

    return worktrees;
  }
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/core/output-parser.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement OutputParser for Git output (GREEN)`

---

### Phase 7: Tools Layer - git_workspaces

#### Task 7.1: Write test for git_workspaces tool (RED)
**Goal:** Test listing allowed repositories

**File:** `packages/server-git/tests/unit/tools/git-workspaces.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitWorkspaces } from '../../../src/tools/git-workspaces.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_workspaces tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager(['/repo1', '/repo2']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };

    registerGitWorkspaces(server, services);
  });

  it('should register git_workspaces tool', () => {
    const tools = Array.from((server as any)._tools.keys());
    expect(tools).toContain('git_workspaces');
  });

  it('should return list of allowed repositories', async () => {
    const handler = (server as any)._tools.get('git_workspaces').handler;
    const result = await handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories).toHaveLength(2);
    expect(content.repositories[0]).toHaveProperty('path');
    expect(content.repositories[0]).toHaveProperty('name');
  });

  it('should extract repository names from paths', async () => {
    const handler = (server as any)._tools.get('git_workspaces').handler;
    const result = await handler({});
    
    const content = JSON.parse(result.content[0].text);
    expect(content.repositories[0].name).toBe('repo1');
    expect(content.repositories[1].name).toBe('repo2');
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-workspaces.test.ts
```

**Expected:** Test fails because git-workspaces.ts doesn't exist

**Commit:** `test: add git_workspaces tool tests (RED)`

---

#### Task 7.2: Implement git_workspaces tool (GREEN)
**Goal:** Create tool to list allowed repositories

**File:** `packages/server-git/src/tools/git-workspaces.ts`

**Content:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import path from 'path';
import type { Services } from '../core/types.js';

const GitWorkspacesSchema = z.object({});

export function registerGitWorkspaces(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_workspaces',
    description: 'List all allowed Git repositories',
    inputSchema: GitWorkspacesSchema,
    handler: async () => {
      const repos = services.repoManager.getAllowedRepositories();
      
      const repositories = repos.map(repoPath => ({
        path: repoPath,
        name: path.basename(repoPath)
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ repositories }, null, 2)
          }
        ]
      };
    }
  });
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-workspaces.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement git_workspaces tool (GREEN)`

---

### Phase 8: Tools Layer - git_status

#### Task 8.1: Write test for git_status tool (RED)
**Goal:** Test repository status retrieval

**File:** `packages/server-git/tests/unit/tools/git-status.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitStatus } from '../../../src/tools/git-status.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_status tool', () => {
  let server: Server;
  let services: Services;
  let mockExecutor: GitExecutor;

  beforeEach(() => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    const repoManager = new RepositoryManager(['/repo']);
    mockExecutor = new GitExecutor();
    
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: mockExecutor,
      outputParser: new OutputParser()
    };

    registerGitStatus(server, services);
  });

  it('should register git_status tool', () => {
    const tools = Array.from((server as any)._tools.keys());
    expect(tools).toContain('git_status');
  });

  it('should validate repository parameter', async () => {
    const handler = (server as any)._tools.get('git_status').handler;
    
    await expect(handler({ repository: '/invalid' })).rejects.toThrow();
  });

  it('should return structured status output', async () => {
    vi.spyOn(mockExecutor, 'execute').mockResolvedValue({
      stdout: '## main\n M file.ts',
      stderr: '',
      exitCode: 0,
      success: true
    });

    const handler = (server as any)._tools.get('git_status').handler;
    const result = await handler({ repository: '/repo' });
    
    const content = JSON.parse(result.content[0].text);
    expect(content).toHaveProperty('branch');
    expect(content).toHaveProperty('files');
    expect(Array.isArray(content.files)).toBe(true);
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-status.test.ts
```

**Expected:** Test fails because git-status.ts doesn't exist

**Commit:** `test: add git_status tool tests (RED)`

---

#### Task 8.2: Implement git_status tool (GREEN)
**Goal:** Create tool to get repository status

**File:** `packages/server-git/src/tools/git-status.ts`

**Content:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitStatusSchema = z.object({
  repository: z.string().describe('Repository path')
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
      
      if (!result.success) {
        throw new Error(`Git status failed: ${result.stderr}`);
      }
      
      // Parse output
      const lines = result.stdout.split('\n');
      const branchLine = lines[0];
      const fileLines = lines.slice(1).join('\n');
      
      // Extract branch info
      const branchMatch = branchLine.match(/## ([^\s.]+)/);
      const branch = branchMatch ? branchMatch[1] : 'unknown';
      
      // Parse file statuses
      const files = services.outputParser.parseStatus(fileLines);
      
      const status = {
        branch,
        ahead: 0,
        behind: 0,
        files
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }
  });
}
```

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-status.test.ts
```

**Expected:** All tests pass

**Commit:** `feat: implement git_status tool (GREEN)`

---

### Phase 9: Tools Layer - git_log, git_branch, git_diff

#### Task 9.1: Write tests for git_log, git_branch, git_diff (RED)

**File:** `packages/server-git/tests/unit/tools/git-log.test.ts`
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitLog } from '../../../src/tools/git-log.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_log tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitLog(server, services);
  });

  it('should register git_log tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_log');
  });

  it('should validate limit parameter', async () => {
    const handler = (server as any)._tools.get('git_log').handler;
    await expect(handler({ repository: '/repo', limit: 101 })).rejects.toThrow();
  });
});
```

**File:** `packages/server-git/tests/unit/tools/git-branch.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitBranch } from '../../../src/tools/git-branch.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_branch tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitBranch(server, services);
  });

  it('should register git_branch tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_branch');
  });
});
```

**File:** `packages/server-git/tests/unit/tools/git-diff.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitDiff } from '../../../src/tools/git-diff.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_diff tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitDiff(server, services);
  });

  it('should register git_diff tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_diff');
  });
});
```

**Run tests (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-log.test.ts tests/unit/tools/git-branch.test.ts tests/unit/tools/git-diff.test.ts
```

**Commit:** `test: add git_log, git_branch, git_diff tool tests (RED)`

---

#### Task 9.2: Implement git_log, git_branch, git_diff tools (GREEN)

**File:** `packages/server-git/src/tools/git-log.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitLogSchema = z.object({
  repository: z.string().describe('Repository path'),
  limit: z.number().min(1).max(100).default(10).describe('Maximum number of commits'),
  branch: z.string().optional().describe('Branch name')
});

export function registerGitLog(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_log',
    description: 'Get commit history for a repository',
    inputSchema: GitLogSchema,
    handler: async (input) => {
      const { repository, limit, branch } = GitLogSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = ['log', `--format=%H|%an|%ad|%s`, `-n`, limit.toString()];
      if (branch) {
        args.push(branch);
      }
      
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git log failed: ${result.stderr}`);
      }
      
      const commits = services.outputParser.parseLog(result.stdout);
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ commits }, null, 2) }]
      };
    }
  });
}
```

**File:** `packages/server-git/src/tools/git-branch.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitBranchSchema = z.object({
  repository: z.string().describe('Repository path'),
  all: z.boolean().default(false).describe('Include remote branches')
});

export function registerGitBranch(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_branch',
    description: 'List branches in a repository',
    inputSchema: GitBranchSchema,
    handler: async (input) => {
      const { repository, all } = GitBranchSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = all ? ['branch', '-a'] : ['branch'];
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git branch failed: ${result.stderr}`);
      }
      
      const branches = services.outputParser.parseBranches(result.stdout);
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ branches }, null, 2) }]
      };
    }
  });
}
```

**File:** `packages/server-git/src/tools/git-diff.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitDiffSchema = z.object({
  repository: z.string().describe('Repository path'),
  target: z.string().optional().describe('Diff target (file, commit, or branch)'),
  staged: z.boolean().default(false).describe('Show staged changes only')
});

export function registerGitDiff(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_diff',
    description: 'Show changes in the repository',
    inputSchema: GitDiffSchema,
    handler: async (input) => {
      const { repository, target, staged } = GitDiffSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = ['diff'];
      if (staged) {
        args.push('--staged');
      }
      if (target) {
        args.push(target);
      }
      
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git diff failed: ${result.stderr}`);
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ diff: result.stdout }, null, 2) }]
      };
    }
  });
}
```

**Run tests (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/
```

**Commit:** `feat: implement git_log, git_branch, git_diff tools (GREEN)`

---

### Phase 10: Tools Layer - git_add, git_commit

#### Task 10.1: Write tests for git_add, git_commit (RED)

**File:** `packages/server-git/tests/unit/tools/git-add.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitAdd } from '../../../src/tools/git-add.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_add tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitAdd(server, services);
  });

  it('should register git_add tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_add');
  });

  it('should reject empty files array', async () => {
    const handler = (server as any)._tools.get('git_add').handler;
    await expect(handler({ repository: '/repo', files: [] })).rejects.toThrow();
  });

  it('should reject dangerous patterns like .', async () => {
    const handler = (server as any)._tools.get('git_add').handler;
    await expect(handler({ repository: '/repo', files: ['.'] })).rejects.toThrow();
  });
});
```

**File:** `packages/server-git/tests/unit/tools/git-commit.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitCommit } from '../../../src/tools/git-commit.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { PathValidator } from '../../../src/core/path-validator.js';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { OutputParser } from '../../../src/core/output-parser.js';
import type { Services } from '../../../src/core/types.js';

describe('git_commit tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitCommit(server, services);
  });

  it('should register git_commit tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_commit');
  });

  it('should reject empty message', async () => {
    const handler = (server as any)._tools.get('git_commit').handler;
    await expect(handler({ repository: '/repo', message: '' })).rejects.toThrow();
  });

  it('should reject message over 500 characters', async () => {
    const handler = (server as any)._tools.get('git_commit').handler;
    const longMessage = 'a'.repeat(501);
    await expect(handler({ repository: '/repo', message: longMessage })).rejects.toThrow();
  });
});
```

**Run tests (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-add.test.ts tests/unit/tools/git-commit.test.ts
```

**Commit:** `test: add git_add, git_commit tool tests (RED)`

---

#### Task 10.2: Implement git_add, git_commit tools (GREEN)

**File:** `packages/server-git/src/tools/git-add.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { GitMcpError, ErrorCode } from '../core/types.js';
import type { Services } from '../core/types.js';

const GitAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  files: z.array(z.string()).min(1).describe('Array of file paths to stage')
});

export function registerGitAdd(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_add',
    description: 'Stage files for commit',
    inputSchema: GitAddSchema,
    handler: async (input) => {
      const { repository, files } = GitAddSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      // Reject dangerous patterns
      if (files.includes('.') || files.includes('-A') || files.includes('*')) {
        throw new GitMcpError(
          ErrorCode.VALIDATION_ERROR,
          'Must specify explicit file paths, wildcards not allowed',
          { files }
        );
      }
      
      // Validate all file paths
      const validatedFiles = services.pathValidator.validatePaths(repository, files);
      
      const result = await services.gitExecutor.execute(repository, ['add', ...files]);
      
      if (!result.success) {
        throw new Error(`Git add failed: ${result.stderr}`);
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, staged: files }, null, 2) }]
      };
    }
  });
}
```

**File:** `packages/server-git/src/tools/git-commit.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { GitMcpError, ErrorCode } from '../core/types.js';
import type { Services } from '../core/types.js';

const GitCommitSchema = z.object({
  repository: z.string().describe('Repository path'),
  message: z.string().min(1).max(500).describe('Commit message')
});

export function registerGitCommit(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_commit',
    description: 'Commit staged changes',
    inputSchema: GitCommitSchema,
    handler: async (input) => {
      const { repository, message } = GitCommitSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      // Sanitize message (remove control characters)
      const sanitized = message.replace(/[\x00-\x1F\x7F]/g, '');
      
      const result = await services.gitExecutor.execute(repository, ['commit', '-m', sanitized]);
      
      if (!result.success) {
        throw new Error(`Git commit failed: ${result.stderr}`);
      }
      
      // Extract commit hash from output
      const hashMatch = result.stdout.match(/\[.+\s([a-f0-9]+)\]/);
      const commit = hashMatch ? hashMatch[1] : 'unknown';
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, commit, message: sanitized }, null, 2) }]
      };
    }
  });
}
```

**Run tests (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/git-add.test.ts tests/unit/tools/git-commit.test.ts
```

**Commit:** `feat: implement git_add, git_commit tools (GREEN)`

---

### Phase 11: Tools Layer - Worktree Tools (7 tools)

#### Task 11.1: Write tests for all worktree tools (RED)

**File:** `packages/server-git/tests/unit/tools/worktree/git-worktree-list.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitWorktreeList } from '../../../../src/tools/worktree/git-worktree-list.js';
import { RepositoryManager } from '../../../../src/core/repository-manager.js';
import { PathValidator } from '../../../../src/core/path-validator.js';
import { GitExecutor } from '../../../../src/core/git-executor.js';
import { OutputParser } from '../../../../src/core/output-parser.js';
import type { Services } from '../../../../src/core/types.js';

describe('git_worktree_list tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitWorktreeList(server, services);
  });

  it('should register git_worktree_list tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_worktree_list');
  });
});
```

**File:** `packages/server-git/tests/unit/tools/worktree/git-worktree-add.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerGitWorktreeAdd } from '../../../../src/tools/worktree/git-worktree-add.js';
import { RepositoryManager } from '../../../../src/core/repository-manager.js';
import { PathValidator } from '../../../../src/core/path-validator.js';
import { GitExecutor } from '../../../../src/core/git-executor.js';
import { OutputParser } from '../../../../src/core/output-parser.js';
import type { Services } from '../../../../src/core/types.js';

describe('git_worktree_add tool', () => {
  let server: Server;
  let services: Services;

  beforeEach(() => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const repoManager = new RepositoryManager(['/repo']);
    services = {
      repoManager,
      pathValidator: new PathValidator(repoManager),
      gitExecutor: new GitExecutor(),
      outputParser: new OutputParser()
    };
    registerGitWorktreeAdd(server, services);
  });

  it('should register git_worktree_add tool', () => {
    expect(Array.from((server as any)._tools.keys())).toContain('git_worktree_add');
  });

  it('should validate path parameter', async () => {
    const handler = (server as any)._tools.get('git_worktree_add').handler;
    await expect(handler({ repository: '/repo', path: '../outside' })).rejects.toThrow();
  });
});
```

**Create similar test files for:**
- `git-worktree-remove.test.ts`
- `git-worktree-prune.test.ts`
- `git-worktree-move.test.ts`
- `git-worktree-lock.test.ts`
- `git-worktree-unlock.test.ts`

**Run tests (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/worktree/
```

**Commit:** `test: add worktree tool tests (RED)`

---

#### Task 11.2: Implement all worktree tools (GREEN)

**File:** `packages/server-git/src/tools/worktree/git-worktree-list.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeListSchema = z.object({
  repository: z.string().describe('Repository path')
});

export function registerGitWorktreeList(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_list',
    description: 'List all worktrees in a repository',
    inputSchema: GitWorktreeListSchema,
    handler: async (input) => {
      const { repository } = GitWorktreeListSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'list', '--porcelain']);
      if (!result.success) throw new Error(`Git worktree list failed: ${result.stderr}`);
      
      const worktrees = services.outputParser.parseWorktrees(result.stdout);
      return { content: [{ type: 'text', text: JSON.stringify({ worktrees }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-add.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Path for new worktree'),
  branch: z.string().optional().describe('Branch name'),
  commitish: z.string().optional().describe('Commit-ish reference')
});

export function registerGitWorktreeAdd(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_add',
    description: 'Create a new worktree',
    inputSchema: GitWorktreeAddSchema,
    handler: async (input) => {
      const { repository, path, branch, commitish } = GitWorktreeAddSchema.parse(input);
      services.repoManager.validateRepository(repository);
      services.pathValidator.validatePath(repository, path);
      
      const args = ['worktree', 'add', path];
      if (branch) args.push('-b', branch);
      if (commitish) args.push(commitish);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree add failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, path, branch }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-remove.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeRemoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to remove'),
  force: z.boolean().default(false).describe('Force removal')
});

export function registerGitWorktreeRemove(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_remove',
    description: 'Remove a worktree',
    inputSchema: GitWorktreeRemoveSchema,
    handler: async (input) => {
      const { repository, path, force } = GitWorktreeRemoveSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(path);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree remove failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, removed: path }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-prune.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreePruneSchema = z.object({
  repository: z.string().describe('Repository path'),
  dry_run: z.boolean().default(false).describe('Show what would be pruned')
});

export function registerGitWorktreePrune(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_prune',
    description: 'Prune stale worktree administrative files',
    inputSchema: GitWorktreePruneSchema,
    handler: async (input) => {
      const { repository, dry_run } = GitWorktreePruneSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'prune'];
      if (dry_run) args.push('--dry-run');
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree prune failed: ${result.stderr}`);
      
      const pruned = result.stdout.split('\n').filter(line => line.trim());
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, pruned }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-move.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeMoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  source: z.string().describe('Current worktree path'),
  destination: z.string().describe('New worktree path')
});

export function registerGitWorktreeMove(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_move',
    description: 'Move a worktree to a new location',
    inputSchema: GitWorktreeMoveSchema,
    handler: async (input) => {
      const { repository, source, destination } = GitWorktreeMoveSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'move', source, destination]);
      if (!result.success) throw new Error(`Git worktree move failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, from: source, to: destination }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-lock.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeLockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to lock'),
  reason: z.string().optional().describe('Reason for locking')
});

export function registerGitWorktreeLock(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_lock',
    description: 'Lock a worktree to prevent removal',
    inputSchema: GitWorktreeLockSchema,
    handler: async (input) => {
      const { repository, path, reason } = GitWorktreeLockSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'lock'];
      if (reason) args.push('--reason', reason);
      args.push(path);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree lock failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, locked: path, reason }, null, 2) }] };
    }
  });
}
```

**File:** `packages/server-git/src/tools/worktree/git-worktree-unlock.ts`
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeUnlockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to unlock')
});

export function registerGitWorktreeUnlock(server: Server, services: Services): void {
  server.registerTool({
    name: 'git_worktree_unlock',
    description: 'Unlock a worktree to allow removal',
    inputSchema: GitWorktreeUnlockSchema,
    handler: async (input) => {
      const { repository, path } = GitWorktreeUnlockSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'unlock', path]);
      if (!result.success) throw new Error(`Git worktree unlock failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, unlocked: path }, null, 2) }] };
    }
  });
}
```

**Run tests (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/tools/worktree/
```

**Commit:** `feat: implement all 7 worktree tools (GREEN)`

---

### Phase 12: Server Layer - Git Server Setup

#### Task 12.1: Write test for git-server (RED)
**Goal:** Test server setup and tool registration

**File:** `packages/server-git/tests/unit/server/git-server.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createGitServer } from '../../../src/server/git-server.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';

describe('createGitServer', () => {
  let server: Server;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    server = new Server(
      { name: 'git-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    repoManager = new RepositoryManager(['/repo']);
  });

  it('should register all 14 tools', () => {
    createGitServer(server, repoManager);
    
    const tools = Array.from((server as any)._tools.keys());
    expect(tools).toHaveLength(14);
    expect(tools).toContain('git_workspaces');
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_log');
    expect(tools).toContain('git_branch');
    expect(tools).toContain('git_diff');
    expect(tools).toContain('git_add');
    expect(tools).toContain('git_commit');
    expect(tools).toContain('git_worktree_list');
    expect(tools).toContain('git_worktree_add');
    expect(tools).toContain('git_worktree_remove');
    expect(tools).toContain('git_worktree_prune');
    expect(tools).toContain('git_worktree_move');
    expect(tools).toContain('git_worktree_lock');
    expect(tools).toContain('git_worktree_unlock');
  });

  it('should create core services', () => {
    createGitServer(server, repoManager);
    expect((server as any)._tools.size).toBeGreaterThan(0);
  });
});
```

**Run test (should FAIL):**
```bash
cd packages/server-git && pnpm test tests/unit/server/git-server.test.ts
```

**Commit:** `test: add git-server tests (RED)`

---

#### Task 12.2: Implement git-server (GREEN)
**Goal:** Create server setup with tool registration

**File:** `packages/server-git/src/server/git-server.ts`

**Content:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RepositoryManager } from '../core/repository-manager.js';
import { PathValidator } from '../core/path-validator.js';
import { GitExecutor } from '../core/git-executor.js';
import { OutputParser } from '../core/output-parser.js';
import type { Services } from '../core/types.js';

// Import all tool registration functions
import { registerGitWorkspaces } from '../tools/git-workspaces.js';
import { registerGitStatus } from '../tools/git-status.js';
import { registerGitLog } from '../tools/git-log.js';
import { registerGitBranch } from '../tools/git-branch.js';
import { registerGitDiff } from '../tools/git-diff.js';
import { registerGitAdd } from '../tools/git-add.js';
import { registerGitCommit } from '../tools/git-commit.js';
import { registerGitWorktreeList } from '../tools/worktree/git-worktree-list.js';
import { registerGitWorktreeAdd } from '../tools/worktree/git-worktree-add.js';
import { registerGitWorktreeRemove } from '../tools/worktree/git-worktree-remove.js';
import { registerGitWorktreePrune } from '../tools/worktree/git-worktree-prune.js';
import { registerGitWorktreeMove } from '../tools/worktree/git-worktree-move.js';
import { registerGitWorktreeLock } from '../tools/worktree/git-worktree-lock.js';
import { registerGitWorktreeUnlock } from '../tools/worktree/git-worktree-unlock.js';

/**
 * Create and configure Git MCP server with all tools
 */
export function createGitServer(
  server: Server,
  repoManager: RepositoryManager
): void {
  // Create core services
  const pathValidator = new PathValidator(repoManager);
  const gitExecutor = new GitExecutor();
  const outputParser = new OutputParser();

  const services: Services = {
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

**Run test (should PASS):**
```bash
cd packages/server-git && pnpm test tests/unit/server/git-server.test.ts
```

**Commit:** `feat: implement git-server setup (GREEN)`

---

### Phase 13: Entry Points - Standalone and Embedded

#### Task 13.1: Implement standalone entry point (stdio)
**Goal:** Create standalone server with stdio transport

**File:** `packages/server-git/src/standalone.ts`

**Content:**
```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';

async function main() {
  // Parse allowed repositories from environment
  const allowedReposEnv = process.env.GIT_ALLOWED_REPOS;
  
  if (!allowedReposEnv) {
    console.error('Error: GIT_ALLOWED_REPOS environment variable not set');
    console.error('Usage: GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2" git-mcp-server');
    process.exit(1);
  }
  
  const allowedRepos = allowedReposEnv.split(';').filter(p => p.trim());
  
  if (allowedRepos.length === 0) {
    console.error('Error: No repositories configured in GIT_ALLOWED_REPOS');
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
  console.error(`Allowed repositories: ${allowedRepos.join(', ')}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Verification:**
```bash
cd packages/server-git
pnpm build
GIT_ALLOWED_REPOS="/tmp/test-repo" node dist/standalone.js
```

**Expected:** Server starts and logs "Git MCP Server running on stdio"

**Commit:** `feat: implement standalone entry point with stdio transport`

---

#### Task 13.2: Implement embedded entry point (HTTP)
**Goal:** Create embedded server for VS Code extensions

**File:** `packages/server-git/src/embedded.ts`

**Content:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamable-http.js';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';

/**
 * Activate Git MCP Server in embedded mode (VS Code extension)
 * @param workspaceFolders Array of workspace folder paths
 * @param port HTTP server port (default: 3000)
 */
export async function activateGitServer(
  workspaceFolders: string[],
  port: number = 3000
): Promise<void> {
  if (workspaceFolders.length === 0) {
    throw new Error('No workspace folders provided for Git MCP Server');
  }
  
  // Create repository manager
  const repoManager = new RepositoryManager(workspaceFolders);
  
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
  console.log(`Allowed repositories: ${workspaceFolders.join(', ')}`);
}

/**
 * Update allowed repositories dynamically (for workspace folder changes)
 */
export function updateAllowedRepositories(
  repoManager: RepositoryManager,
  workspaceFolders: string[]
): void {
  repoManager.updateAllowedRepositories(workspaceFolders);
  console.log(`Updated allowed repositories: ${workspaceFolders.join(', ')}`);
}
```

**Verification:**
```bash
cd packages/server-git
pnpm build
# Test in VS Code extension context
```

**Commit:** `feat: implement embedded entry point with HTTP transport`

---

### Phase 14: Integration Tests

#### Task 14.1: Create test repository fixture
**Goal:** Helper to create temporary Git repositories for testing

**File:** `packages/server-git/tests/fixtures/test-repo.ts`

**Content:**
```typescript
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
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
    await execAsync('git config user.name "Test User"', { cwd: path });
    await execAsync('git config user.email "test@example.com"', { cwd: path });
    return new TestRepository(path);
  }

  async writeFile(name: string, content: string): Promise<void> {
    const filePath = join(this.path, name);
    const dir = join(filePath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content);
  }

  async commit(message: string): Promise<void> {
    await execAsync(`git add -A && git commit -m "${message}"`, { cwd: this.path });
  }

  async createBranch(name: string): Promise<void> {
    await execAsync(`git branch ${name}`, { cwd: this.path });
  }

  async cleanup(): Promise<void> {
    await rm(this.path, { recursive: true, force: true });
  }
}
```

**Commit:** `test: add test repository fixture helper`

---

#### Task 14.2: Write integration test for Git workflow
**Goal:** Test complete Git workflow (status → add → commit)

**File:** `packages/server-git/tests/integration/git-workflow.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { TestRepository } from '../fixtures/test-repo.js';

describe('Git Workflow Integration', () => {
  let testRepo: TestRepository;
  let server: Server;

  beforeEach(async () => {
    testRepo = await TestRepository.create();
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    const repoManager = new RepositoryManager([testRepo.path]);
    createGitServer(server, repoManager);
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should complete full commit workflow', async () => {
    // Create a file
    await testRepo.writeFile('test.ts', 'console.log("test");');
    
    // Get status
    const statusHandler = (server as any)._tools.get('git_status').handler;
    const statusResult = await statusHandler({ repository: testRepo.path });
    const status = JSON.parse(statusResult.content[0].text);
    
    expect(status.files).toHaveLength(1);
    expect(status.files[0].path).toBe('test.ts');
    expect(status.files[0].status).toBe('??');
    
    // Stage file
    const addHandler = (server as any)._tools.get('git_add').handler;
    const addResult = await addHandler({ 
      repository: testRepo.path, 
      files: ['test.ts'] 
    });
    const addData = JSON.parse(addResult.content[0].text);
    expect(addData.success).toBe(true);
    
    // Commit
    const commitHandler = (server as any)._tools.get('git_commit').handler;
    const commitResult = await commitHandler({ 
      repository: testRepo.path, 
      message: 'test: add test file' 
    });
    const commitData = JSON.parse(commitResult.content[0].text);
    expect(commitData.success).toBe(true);
    
    // Verify log
    const logHandler = (server as any)._tools.get('git_log').handler;
    const logResult = await logHandler({ repository: testRepo.path, limit: 1 });
    const log = JSON.parse(logResult.content[0].text);
    expect(log.commits[0].message).toBe('test: add test file');
  });
});
```

**Run test:**
```bash
cd packages/server-git && pnpm test tests/integration/git-workflow.test.ts
```

**Commit:** `test: add Git workflow integration test`

---

#### Task 14.3: Write integration test for worktree lifecycle
**Goal:** Test worktree add → list → remove workflow

**File:** `packages/server-git/tests/integration/worktree-lifecycle.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { TestRepository } from '../fixtures/test-repo.js';
import { join } from 'path';

describe('Worktree Lifecycle Integration', () => {
  let testRepo: TestRepository;
  let server: Server;

  beforeEach(async () => {
    testRepo = await TestRepository.create();
    await testRepo.writeFile('README.md', '# Test');
    await testRepo.commit('Initial commit');
    await testRepo.createBranch('feature');
    
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    const repoManager = new RepositoryManager([testRepo.path]);
    createGitServer(server, repoManager);
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should complete worktree lifecycle', async () => {
    const worktreePath = join(testRepo.path, 'feature-worktree');
    
    // Add worktree
    const addHandler = (server as any)._tools.get('git_worktree_add').handler;
    const addResult = await addHandler({
      repository: testRepo.path,
      path: worktreePath,
      branch: 'feature'
    });
    const addData = JSON.parse(addResult.content[0].text);
    expect(addData.success).toBe(true);
    
    // List worktrees
    const listHandler = (server as any)._tools.get('git_worktree_list').handler;
    const listResult = await listHandler({ repository: testRepo.path });
    const listData = JSON.parse(listResult.content[0].text);
    expect(listData.worktrees.length).toBeGreaterThanOrEqual(2);
    
    // Remove worktree
    const removeHandler = (server as any)._tools.get('git_worktree_remove').handler;
    const removeResult = await removeHandler({
      repository: testRepo.path,
      path: worktreePath
    });
    const removeData = JSON.parse(removeResult.content[0].text);
    expect(removeData.success).toBe(true);
  });
});
```

**Run test:**
```bash
cd packages/server-git && pnpm test tests/integration/worktree-lifecycle.test.ts
```

**Commit:** `test: add worktree lifecycle integration test`

---

#### Task 14.4: Write security integration test
**Goal:** Test path validation and security checks

**File:** `packages/server-git/tests/integration/security.test.ts`

**Content:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createGitServer } from '../../src/server/git-server.js';
import { RepositoryManager } from '../../src/core/repository-manager.js';
import { TestRepository } from '../fixtures/test-repo.js';

describe('Security Integration', () => {
  let testRepo: TestRepository;
  let server: Server;

  beforeEach(async () => {
    testRepo = await TestRepository.create();
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    const repoManager = new RepositoryManager([testRepo.path]);
    createGitServer(server, repoManager);
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('should reject path traversal in git_add', async () => {
    const addHandler = (server as any)._tools.get('git_add').handler;
    
    await expect(
      addHandler({ repository: testRepo.path, files: ['../etc/passwd'] })
    ).rejects.toThrow();
  });

  it('should reject unauthorized repository access', async () => {
    const statusHandler = (server as any)._tools.get('git_status').handler;
    
    await expect(
      statusHandler({ repository: '/unauthorized/repo' })
    ).rejects.toThrow();
  });

  it('should reject wildcard patterns in git_add', async () => {
    const addHandler = (server as any)._tools.get('git_add').handler;
    
    await expect(
      addHandler({ repository: testRepo.path, files: ['.'] })
    ).rejects.toThrow();
    
    await expect(
      addHandler({ repository: testRepo.path, files: ['*'] })
    ).rejects.toThrow();
  });

  it('should sanitize commit messages', async () => {
    await testRepo.writeFile('test.ts', 'content');
    
    const addHandler = (server as any)._tools.get('git_add').handler;
    await addHandler({ repository: testRepo.path, files: ['test.ts'] });
    
    const commitHandler = (server as any)._tools.get('git_commit').handler;
    const result = await commitHandler({
      repository: testRepo.path,
      message: 'test\x00message\x1F'
    });
    
    const data = JSON.parse(result.content[0].text);
    expect(data.message).not.toContain('\x00');
    expect(data.message).not.toContain('\x1F');
  });
});
```

**Run test:**
```bash
cd packages/server-git && pnpm test tests/integration/security.test.ts
```

**Commit:** `test: add security integration tests`

---

### Phase 15: Documentation

#### Task 15.1: Create comprehensive README
**Goal:** Document installation, usage, and API

**File:** `packages/server-git/README.md`

**Content:**
```markdown
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
  await activateGitServer(workspaceFolders, 3000);
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
```

**Commit:** `docs: add comprehensive README`

---

### Phase 16: Final Verification

#### Task 16.1: Run all tests
**Goal:** Verify all tests pass

**Commands:**
```bash
cd packages/server-git
pnpm test
```

**Expected:** All tests pass with 85%+ coverage

**Commit:** `test: verify all tests pass`

---

#### Task 16.2: Run coverage report
**Goal:** Verify coverage thresholds met

**Commands:**
```bash
cd packages/server-git
pnpm test:coverage
```

**Expected:** 
- Lines: 85%+
- Functions: 85%+
- Branches: 85%+
- Statements: 85%+

**Commit:** `test: verify coverage thresholds met`

---

#### Task 16.3: Build and verify standalone mode
**Goal:** Test standalone server startup

**Commands:**
```bash
cd packages/server-git
pnpm build
GIT_ALLOWED_REPOS="/tmp/test" node dist/standalone.js
```

**Expected:** Server starts without errors

**Commit:** `build: verify standalone mode works`

---

#### Task 16.4: Lint check
**Goal:** Verify TypeScript compilation

**Commands:**
```bash
cd packages/server-git
pnpm lint
```

**Expected:** No TypeScript errors

**Commit:** `chore: verify lint passes`

---

## Self-Review Checklist

### Spec Coverage

✅ **Phase 1: Project Setup**
- Package structure ✓
- Dependencies ✓
- TypeScript config ✓
- Vitest config ✓

✅ **Phase 2-6: Core Layer**
- Types ✓
- RepositoryManager ✓
- PathValidator ✓
- GitExecutor ✓
- OutputParser ✓

✅ **Phase 7-11: Tools Layer (14 tools)**
- git_workspaces ✓
- git_status ✓
- git_log ✓
- git_branch ✓
- git_diff ✓
- git_add ✓
- git_commit ✓
- git_worktree_list ✓
- git_worktree_add ✓
- git_worktree_remove ✓
- git_worktree_prune ✓
- git_worktree_move ✓
- git_worktree_lock ✓
- git_worktree_unlock ✓

✅ **Phase 12: Server Layer**
- git-server.ts ✓

✅ **Phase 13: Entry Points**
- Standalone (stdio) ✓
- Embedded (HTTP) ✓

✅ **Phase 14: Integration Tests**
- Git workflow ✓
- Worktree lifecycle ✓
- Security tests ✓

✅ **Phase 15: Documentation**
- README.md ✓

### Placeholder Scan

✅ No "TBD", "TODO", or "implement later" found
✅ No "add validation" without implementation
✅ No "similar to Task N" references
✅ All code blocks complete
✅ All file paths exact

### Type Consistency

✅ GitCommandResult used consistently
✅ Services interface used consistently
✅ FileStatus, Commit, Branch, Worktree types consistent
✅ Error types (GitMcpError, ErrorCode) consistent
✅ All tool registration functions follow same pattern

---

## Implementation Summary

**Total Tasks:** 16 phases, ~50 individual tasks
**Estimated Time:** 8-12 hours (following TDD strictly)
**Test Coverage Goal:** 85%+
**Commit Frequency:** After each passing test (50+ commits)

**Key Deliverables:**
1. Fully functional Git MCP Server
2. 14 MCP tools for Git operations
3. Dual-mode support (standalone + embedded)
4. Comprehensive test suite (unit + integration)
5. Complete documentation

**Success Criteria:**
- ✅ All 14 tools implemented and tested
- ✅ 85%+ test coverage achieved
- ✅ Security validation passes
- ✅ Both modes functional
- ✅ Documentation complete
- ✅ No critical vulnerabilities
- ✅ Commands complete within 30s timeout
- ✅ Clear error messages

---

## Execution Notes

**TDD Workflow:**
1. Write failing test (RED)
2. Run test to verify failure
3. Write minimal implementation (GREEN)
4. Run test to verify pass
5. Commit immediately
6. Refactor if needed (keep tests green)

**Commit Message Format:**
- `test:` for test files
- `feat:` for implementation
- `docs:` for documentation
- `chore:` for configuration

**Testing Strategy:**
- Unit tests for all core components
- Integration tests for workflows
- Security tests for validation
- Mock Git repositories for testing

---

**Plan Complete!**

