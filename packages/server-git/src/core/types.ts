import type { RepositoryManager } from './repository-manager.ts';
import type { PathValidator } from './path-validator.ts';
import type { GitExecutor } from './git-executor.ts';
import type { OutputParser } from './output-parser.ts';

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
 * Logging sink used by the executor and tools. Structural (satisfied by `McpLogger`) so the published
 * declarations do not reference the private shared packages that are bundled at build time.
 */
export interface ServerLogger {
  debug(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

/**
 * Core services available to tools
 */
export interface Services {
  repoManager: RepositoryManager;
  pathValidator: PathValidator;
  gitExecutor: GitExecutor;
  outputParser: OutputParser;
  logger?: ServerLogger;
}

/**
 * Error codes
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  GIT_ERROR: 'GIT_ERROR',
  SECURITY_ERROR: 'SECURITY_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base error class
 */
export class GitMcpError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GitMcpError';
    this.code = code;
    this.details = details;
  }
}
