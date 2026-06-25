import path from 'node:path';
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
