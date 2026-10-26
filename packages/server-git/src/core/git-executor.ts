import { execFile } from 'node:child_process';
import which from 'which';
import { GitMcpError, ErrorCode } from './types.js';
import type { RepositoryManager } from './repository-manager.js';
import type { GitCommandResult, ExecuteOptions, ServerLogger } from './types.js';

const POSIX_ALLOWED = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
];
const WINDOWS_ONLY = [
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
];

/**
 * Build the environment handed to git (and so to hooks, credential helpers and ssh): an allow-list
 * of what git needs to work, never the parent's full environment, so server secrets such as
 * `MCP_AUTH_TOKEN` or API keys cannot reach repository-controlled code. `GIT_TERMINAL_PROMPT=0`
 * keeps git non-interactive and `GIT_ALLOW_PROTOCOL` blocks remote-helper transports like `ext::`.
 */
export function buildGitEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const windows = platform === 'win32';
  const allowed = new Set((windows ? [...POSIX_ALLOWED, ...WINDOWS_ONLY] : POSIX_ALLOWED).map((k) => (windows ? k.toLowerCase() : k)));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lookup = windows ? key.toLowerCase() : key;
    if (windows && lookup === 'path') {
      env['PATH'] = value;
    } else if (allowed.has(lookup) || key.startsWith('LC_')) {
      env[key] = value;
    }
  }
  env['PATH'] ??= '';
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_ALLOW_PROTOCOL'] = 'file:git:http:https:ssh';
  return env;
}

/**
 * Config prefixed to every git invocation (`git -c k=v ... <args>`; command-line config outranks
 * `.git/config`). A repository the server is pointed at is untrusted input: its local config could
 * otherwise run commands on plain `git status` (`core.fsmonitor`), launch a pager, or run an external
 * diff driver. Only settings that no legitimate use depends on are overridden.
 *
 * Deliberately NOT overridden: `core.sshCommand`, `core.hooksPath`, `credential.helper` and `url.*`.
 * Operators legitimately configure them (private keys, corporate hooks, credential managers, mirrors)
 * and forcing them off would break fetch/pull/push and commit hooks; hooks and helpers already run
 * with the allow-listed environment from buildGitEnvironment, so server secrets cannot reach them.
 * `core.askPass=` stops git from spawning an askpass program (prompting is already off via
 * GIT_TERMINAL_PROMPT=0).
 */
export const HARDENING_CONFIG: readonly string[] = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.pager=cat',
  '-c', 'diff.external=',
  '-c', 'core.askPass=',
];

/**
 * Executes Git commands safely with timeout protection
 */
export class GitExecutor {
  private static readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private static gitPath: string | null = null;
  private readonly logger: ServerLogger | undefined;
  private readonly repoManager: RepositoryManager | undefined;

  /**
   * @param repoManager when given, every `execute` re-validates its repository against the allow-list and
   *   runs git in the validated REAL path, so no tool can reach git with an unchecked or symlink-confused
   *   `cwd`, whatever it validated (or forgot to validate) beforehand.
   */
  constructor(logger?: ServerLogger, repoManager?: RepositoryManager) {
    this.logger = logger;
    this.repoManager = repoManager;
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
    const cwd = this.repoManager ? this.repoManager.validateRepository(repoPath) : repoPath;
    const gitPath = await GitExecutor.findGit();
    this.logger?.debug({ cmd: `git ${args.join(' ')}`, cwd });

    return new Promise((resolve, reject) => {
      let timedOut = false;
      
      // Allow-listed environment only (see buildGitEnvironment): no secrets reach git, hooks or helpers.
      const env = buildGitEnvironment(process.env);
      
      // Use execFile which handles paths with spaces better than spawn
      const proc = execFile(gitPath, [...HARDENING_CONFIG, ...args], {
        cwd,
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
