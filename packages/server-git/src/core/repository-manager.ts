import path from 'node:path';
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
