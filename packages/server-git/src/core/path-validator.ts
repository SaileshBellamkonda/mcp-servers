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

    // Resolve path against repository root using posix for consistency
    const normalizedFile = filePath.replace(/\\/g, '/');
    const resolved = path.posix.join(validatedRepo, normalizedFile);
    const normalizedResolved = path.posix.normalize(resolved);

    // Ensure resolved path is within repository
    if (!normalizedResolved.startsWith(validatedRepo + '/') && normalizedResolved !== validatedRepo) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Path outside repository: ${filePath}`,
        { path: filePath, repository: repoPath, resolved: normalizedResolved }
      );
    }

    return normalizedResolved;
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
