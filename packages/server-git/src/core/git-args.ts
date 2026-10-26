import path from 'node:path';
import { parseBool } from '@mcp-servers/common';
import { GitMcpError, ErrorCode } from './types.js';
import type { GitExecutor } from './git-executor.js';

/**
 * Validators for every user-supplied string that ends up in a git argument vector.
 *
 * `execFile` already prevents shell injection; what remains is *option injection* (a value such as
 * `--upload-pack=<cmd>` or `--output=<file>` being parsed by git as an option) and values git itself
 * interprets (`ext::` transports, pathspec magic). All validators fail closed and never echo the
 * rejected value back, because it may carry credentials (for example a URL).
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
/** `<helper>::<address>` remote-helper syntax (`ext::`, `fd::`, ...). */
const REMOTE_HELPER = /^[A-Za-z0-9+.-]+::/;
/** A configured remote name as `git remote` lists it. */
const REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
/** Characters git forbids in ref names (git check-ref-format), plus `+` and `:` which make refspecs. */
// eslint-disable-next-line no-control-regex
const BRANCH_FORBIDDEN = /[\s~^:?*[\\+\x00-\x1F\x7F]/;

function reject(label: string, reason: string): never {
  throw new GitMcpError(ErrorCode.VALIDATION_ERROR, `Invalid ${label}: ${reason}`, { label });
}

/**
 * A ref, commit, branch, tag, target or similar value that is passed to git positionally. Must be
 * non-empty, must not start with `-` (git would parse it as an option) and must not contain control
 * characters (NUL, newlines, ...).
 */
export function assertSafeRefLike(value: string, label: string): string {
  if (value.trim() === '') reject(label, 'must not be empty');
  if (value.startsWith('-')) reject(label, 'must not start with "-" (it would be parsed as a git option)');
  if (CONTROL_CHARS.test(value)) reject(label, 'must not contain control characters');
  return value;
}

/** Stricter than {@link assertSafeRefLike}: a plain branch/ref name, never a refspec (no `:` or `+`). */
export function assertBranchName(value: string, label: string): string {
  assertSafeRefLike(value, label);
  if (
    BRANCH_FORBIDDEN.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.endsWith('/') ||
    value.endsWith('.lock')
  ) {
    reject(label, 'must be a plain branch name (no refspecs, spaces or special characters)');
  }
  return value;
}

/** A remote *name* (what `git remote add <name>` accepts here). */
export function assertRemoteName(value: string, label = 'remote name'): string {
  assertSafeRefLike(value, label);
  if (!REMOTE_NAME.test(value)) reject(label, 'must consist of letters, digits, ".", "_", "-" and "/"');
  return value;
}

/** A remote URL or path. Refuses option-like values and remote-helper transports such as `ext::`. */
export function assertRemoteUrl(value: string, label = 'remote URL'): string {
  assertSafeRefLike(value, label);
  if (REMOTE_HELPER.test(value)) reject(label, 'remote-helper transports (for example "ext::") are not allowed');
  return value;
}

/**
 * Explicit file paths for `git add`. Rejects options, pathspec magic (a leading `:`), control
 * characters and - when `repoRoot` is given - any spelling of the repository root (`.`, `./`, ...)
 * so that "stage everything" cannot be smuggled past the explicit-path rule.
 */
export function assertPathspecs(files: readonly string[], repoRoot?: string): void {
  for (const file of files) {
    assertSafeRefLike(file, 'file path');
    if (file.startsWith(':')) reject('file path', 'pathspec magic (a leading ":") is not allowed');
    if (repoRoot !== undefined && path.resolve(repoRoot, file) === path.resolve(repoRoot)) {
      throw new GitMcpError(
        ErrorCode.VALIDATION_ERROR,
        'Must specify explicit file paths, wildcards not allowed',
        { files: [...files] },
      );
    }
  }
}

/** Whether remotes may be given as URLs/paths (opt-in via `GIT_ALLOW_REMOTE_URLS`). */
export function remoteUrlsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBool(env['GIT_ALLOW_REMOTE_URLS'], false);
}

/**
 * Validate the `remote` argument of fetch/pull/push. By default it must be the name of a remote
 * configured in the repository (checked with `git remote`), which also keeps pushes under the
 * `GIT_PUSH_ALLOWED_BRANCHES` policy and stops arbitrary-URL egress. `GIT_ALLOW_REMOTE_URLS=1`
 * additionally permits URLs/paths (still never option-like values or `ext::`-style helpers).
 */
export async function resolveRemote(
  executor: GitExecutor,
  repository: string,
  remote: string,
): Promise<string> {
  assertSafeRefLike(remote, 'remote');

  if (remoteUrlsAllowed()) {
    return assertRemoteUrl(remote, 'remote');
  }

  const listed = await executor.execute(repository, ['remote']);
  if (!listed.success) {
    throw new GitMcpError(ErrorCode.GIT_ERROR, 'Unable to list the configured remotes of the repository', {
      repository,
    });
  }
  const configured = listed.stdout.split('\n').map((r) => r.trim()).filter(Boolean);
  if (!REMOTE_NAME.test(remote) || !configured.includes(remote)) {
    throw new GitMcpError(
      ErrorCode.SECURITY_ERROR,
      'Remote must be the name of a configured remote (set GIT_ALLOW_REMOTE_URLS=1 to allow URLs)',
      { configured },
    );
  }
  return remote;
}
