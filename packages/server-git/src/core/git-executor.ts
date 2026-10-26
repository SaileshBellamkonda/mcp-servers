import { execFile } from 'node:child_process';
import which from 'which';
import { GitMcpError, ErrorCode } from './types.js';
import type { GitCommandResult, ExecuteOptions } from './types.js';
import type { McpLogger } from '@mcp-servers/common';

/**
 * Executes Git commands safely with timeout protection
 */
export class GitExecutor {
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private static gitPath: string | null = null;
  private readonly logger: McpLogger | undefined;

  constructor(logger?: McpLogger) {
    this.logger = logger;
  }

  /**
   * Find git executable path
   */
  private static async findGit(): Promise<string> {
    if (this.gitPath) {
      return this.gitPath;
    }

    try {
      const gitPath = await which('git');
      if (!gitPath) {
        throw new Error('Git executable not found');
      }
      this.gitPath = gitPath;
      return this.gitPath;
    } catch (error) {
      throw new GitMcpError(
        ErrorCode.GIT_ERROR,
        'Git executable not found in PATH',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

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
    const gitPath = await GitExecutor.findGit();
    this.logger?.debug({ cmd: `git ${args.join(' ')}`, cwd: repoPath });

    return new Promise((resolve, reject) => {
      let timedOut = false;
      
      // Ensure PATH is set in environment for child process
      const env = {
        ...process.env,
        PATH: process.env['PATH'] ?? process.env['Path'] ?? '',
      };
      
      // Use execFile which handles paths with spaces better than spawn
      const proc = execFile(gitPath, args, {
        cwd: repoPath,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }, (error, stdout, stderr) => {
        clearTimeout(timeoutId);
        
        if (timedOut) {
          // Timeout error
          reject(new GitMcpError(
            ErrorCode.GIT_ERROR,
            `Git command timed out after ${String(timeout)}ms`,
            { args, timeout }
          ));
          return;
        }
        
        // Check if error is an execution error (not just non-zero exit code)
        // execFile errors that are non-exit-code failures have no numeric .code
        interface ExecError extends Error {
          code?: number | string;
        }
        const execError = error as ExecError | null;
        if (execError && typeof execError.code !== 'number' && typeof execError.code !== 'string') {
          // Execution error (git not found, permission denied, etc.)
          reject(new GitMcpError(
            ErrorCode.GIT_ERROR,
            `Failed to execute git command: ${execError.message}`,
            { args, error: execError.message }
          ));
          return;
        }
        
        // Handle both success and failure (non-zero exit code)
        const exitCode = (execError?.code != null && typeof execError.code === 'number')
          ? execError.code
          : 0;
        const result: GitCommandResult = {
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode,
          success: exitCode === 0,
        };
        
        resolve(result);
      });

      // Set up timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);

      // Send stdin if provided
      if (options.input) {
        proc.stdin?.write(options.input);
        proc.stdin?.end();
      }
    });
  }
}
