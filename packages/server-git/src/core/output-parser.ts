import type { FileStatus, Commit, Branch, Worktree } from './types.js';

/**
 * Parses Git command output into structured data
 */
export class OutputParser {
  /**
   * Parse git status --porcelain output
   */
  parseStatus(output: string): FileStatus[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const statusCode = line.substring(0, 2);
        const path = line.substring(3);
        
        const staged = statusCode[0] !== ' ' && statusCode[0] !== '?';
        const unstaged = statusCode[1] !== ' ' || statusCode[0] === '?';

        return {
          path,
          status: statusCode.trim() || statusCode,
          staged,
          unstaged
        };
      });
  }

  /**
   * Parse git log output (format: %H|%an|%ad|%s)
   */
  parseLog(output: string): Commit[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('|');
        const hash = parts[0] ?? '';
        const author = parts[1] ?? '';
        const date = parts[2] ?? '';
        const message = parts[3] ?? '';
        return { hash, author, date, message };
      });
  }

  /**
   * Parse git branch output
   */
  parseBranches(output: string): Branch[] {
    if (!output.trim()) return [];

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const current = line.startsWith('*');
        const remote = line.includes('remotes/');
        
        let name = line.substring(2).trim();
        if (remote) {
          name = name.replace('remotes/', '');
        }

        return { name, current, remote };
      });
  }

  /**
   * Parse git worktree list --porcelain output
   */
  parseWorktrees(output: string): Worktree[] {
    if (!output.trim()) return [];

    const worktrees: Worktree[] = [];
    const blocks = output.split('\n\n').filter(block => block.trim());

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktree: Partial<Worktree> = {
        locked: false,
        prunable: false
      };

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktree.path = line.substring(9);
        } else if (line.startsWith('HEAD ')) {
          worktree.commit = line.substring(5);
        } else if (line.startsWith('branch ')) {
          const branchRef = line.substring(7);
          worktree.branch = branchRef.replace('refs/heads/', '');
        } else if (line === 'locked') {
          worktree.locked = true;
        } else if (line === 'prunable') {
          worktree.prunable = true;
        }
      }

      if (worktree.path && worktree.commit && worktree.branch) {
        worktrees.push(worktree as Worktree);
      }
    }

    return worktrees;
  }
}
