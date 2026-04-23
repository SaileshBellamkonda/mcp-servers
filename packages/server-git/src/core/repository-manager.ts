import path from 'path';
import { GitMcpError, ErrorCode } from './types.js';

export class RepositoryManager {
  private allowedRepos: string[];

  constructor(repositories: string[]) {
    this.allowedRepos = repositories.map(repo => this.normalizePath(repo));
  }

  getAllowedRepositories(): string[] {
    return [...this.allowedRepos];
  }

  isRepositoryAllowed(repoPath: string): boolean {
    const normalized = this.normalizePath(repoPath);
    return this.allowedRepos.includes(normalized);
  }

  validateRepository(repoPath: string): string {
    const normalized = this.normalizePath(repoPath);
    
    if (!this.isRepositoryAllowed(normalized)) {
      throw new GitMcpError(
        ErrorCode.SECURITY_ERROR,
        `Repository not allowed: ${repoPath}`,
        { repository: repoPath, allowed: this.allowedRepos }
      );
    }
    
    return normalized;
  }

  updateAllowedRepositories(repos: string[]): void {
    this.allowedRepos = repos.map(repo => this.normalizePath(repo));
  }

  private normalizePath(repoPath: string): string {
    // Use posix path normalization to ensure consistent forward slashes
    // This is important for cross-platform compatibility
    let normalized = path.posix.normalize(repoPath.replace(/\\/g, '/'));
    // Remove trailing slash if present (except for root path)
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }
}
