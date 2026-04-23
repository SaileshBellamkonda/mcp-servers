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
