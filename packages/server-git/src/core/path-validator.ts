import fs from 'node:fs';
import path from 'node:path';
import { GitMcpError, ErrorCode } from './types.ts';
import type { RepositoryManager } from './repository-manager.ts';

/**
 * Validates and sanitizes file paths to prevent security vulnerabilities
 */
export class PathValidator {
  private static readonly DANGEROUS_PATTERNS = [
    /(?:^|[\\/])\.\.(?:[\\/]|$)/, // Parent directory traversal (a ".." path segment, not a substring)
    /^~/,             // Home directory expansion
    /^\/etc\//,       // System directories
    /^\/root\//,
    /^\/sys\//,
    /^\/proc\//,
    /^C:\\Windows\\/i, // Windows system directories
    /^C:\\Program Files/i,
  ];

  private readonly repoManager: RepositoryManager;

  constructor(repoManager: RepositoryManager) {
    this.repoManager = repoManager;
  }

  /**
   * Validate a path is safe and within an allowed repository.
   * Uses platform-native path resolution to prevent path traversal on all OSes.
   * @throws GitMcpError if path is invalid or unsafe
   */
  validatePath(repoPath: string, filePath: string): string {
    // validateRepository returns a path already normalized with path.normalize()
    const validatedRepo = this.repoManager.validateRepository(repoPath);

    // Check for dangerous patterns before resolution
    if (!this.isSafePath(filePath)) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Unsafe path detected: ${filePath}`,
        { path: filePath, repository: repoPath }
      );
    }

    // Resolve and normalize using native path APIs (OWASP A01 — path traversal prevention)
    const resolved = path.normalize(path.resolve(validatedRepo, filePath));
    const relativeToRepo = path.relative(validatedRepo, resolved);
    const isInside = relativeToRepo === '' || (!relativeToRepo.startsWith('..' + path.sep) && relativeToRepo !== '..');
    if (!isInside) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Path outside repository: ${filePath}`,
        { path: filePath, repository: repoPath, resolved }
      );
    }

    // Symlinks: the lexical check above cannot see them. Resolve the deepest ancestor that exists
    // (the leaf may not exist yet) and require the real location to stay inside the real repository.
    const realRepo = PathValidator.realpathOfDeepestAncestor(validatedRepo);
    const realResolved = PathValidator.realpathOfDeepestAncestor(resolved);
    const realRelative = path.relative(realRepo, realResolved);
    const realInside =
      realRelative === '' || (!realRelative.startsWith('..' + path.sep) && realRelative !== '..' && !path.isAbsolute(realRelative));
    if (!realInside) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Path resolves outside repository through a symbolic link: ${filePath}`,
        { path: filePath, repository: repoPath }
      );
    }

    return resolved;
  }

  /**
   * `realpath` of the deepest existing ancestor of `target` joined with the not-yet-existing rest.
   * Falls back to the lexical path when nothing on the way can be resolved.
   */
  private static realpathOfDeepestAncestor(target: string): string {
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
