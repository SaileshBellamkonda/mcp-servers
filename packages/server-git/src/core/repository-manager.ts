import fs from 'node:fs';
import path from 'node:path';
import { GitMcpError, ErrorCode } from './types.js';

/** True when `repoPath` contains a `..` segment (either separator style). */
function hasParentSegment(repoPath: string): boolean {
  return repoPath.split(/[\\/]/).includes('..');
}

/**
 * `realpath` of the deepest existing ancestor of `target` joined with the not-yet-existing rest.
 * Lets an allowed entry or a requested repository that does not exist yet still be compared.
 */
function realpathOfDeepestAncestor(target: string): string {
  const rest: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Case-insensitive file systems (Windows) compare paths without regard to case. */
function comparable(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export class RepositoryManager {
  private allowedRepos: string[];

  constructor(repositories: string[]) {
    this.allowedRepos = repositories.map(repo => this.normalizePath(repo));
  }

  getAllowedRepositories(): string[] {
    return [...this.allowedRepos];
  }

  isRepositoryAllowed(repoPath: string): boolean {
    return this.resolveAllowed(repoPath) !== undefined;
  }

  /**
   * Validate that `repoPath` is an allowed repository and return its REAL path (symlinks resolved).
   * Callers must run git in the returned path, never in the raw input: a lexical check on the input
   * cannot see a symlink (`<repo>/lnk/..` is lexically `<repo>` but physically the link target's parent).
   * Any `..` segment is refused outright.
   */
  validateRepository(repoPath: string): string {
    const real = this.resolveAllowed(repoPath);
    if (real === undefined) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Repository not allowed: ${repoPath}`,
        { repository: repoPath, allowed: this.allowedRepos }
      );
    }
    return real;
  }

  updateAllowedRepositories(repos: string[]): void {
    this.allowedRepos = repos.map(repo => this.normalizePath(repo));
  }

  /** The real path of `repoPath` when it equals the real path of an allowed entry, else undefined. */
  private resolveAllowed(repoPath: string): string | undefined {
    if (hasParentSegment(repoPath)) return undefined;
    const real = realpathOfDeepestAncestor(path.resolve(repoPath));
    // Allowed entries are resolved on every call (cheap) so a repository cloned after start-up,
    // or a symlink re-pointed later, is judged by what is on disk now.
    const wanted = comparable(real);
    const match = this.allowedRepos.some(
      allowed => comparable(realpathOfDeepestAncestor(path.resolve(allowed))) === wanted
    );
    return match ? real : undefined;
  }

  private normalizePath(repoPath: string): string {
    // Use platform-native path.normalize for consistent cross-platform behavior.
    // This ensures Windows paths (C:\\foo) and POSIX paths (/foo) are handled correctly
    // and that path-validator's path.resolve+path.sep containment check works on all OSes.
    let normalized = path.normalize(repoPath);
    // Remove trailing separator if present (except for root paths like / or C:\\)
    if (normalized.length > 1 && normalized.endsWith(path.sep)) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }
}
