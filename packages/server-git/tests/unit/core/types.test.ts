import { describe, it, expect } from 'vitest';
import type {
  GitCommandResult,
  FileStatus,
  Commit,
  Branch,
  Worktree
} from '../../../src/core/types.ts';

describe('Core Types', () => {
  it('should define GitCommandResult interface', () => {
    const result: GitCommandResult = {
      stdout: 'output',
      stderr: '',
      exitCode: 0,
      success: true
    };
    expect(result.stdout).toBe('output');
    expect(result.success).toBe(true);
  });

  it('should define FileStatus interface', () => {
    const status: FileStatus = {
      path: 'src/file.ts',
      status: 'M',
      staged: false,
      unstaged: true
    };
    expect(status.path).toBe('src/file.ts');
  });

  it('should define Commit interface', () => {
    const commit: Commit = {
      hash: 'abc123',
      author: 'John Doe',
      date: '2024-01-01',
      message: 'Initial commit'
    };
    expect(commit.hash).toBe('abc123');
  });

  it('should define Branch interface', () => {
    const branch: Branch = {
      name: 'main',
      current: true,
      remote: false
    };
    expect(branch.current).toBe(true);
  });

  it('should define Worktree interface', () => {
    const worktree: Worktree = {
      path: '/path/to/worktree',
      branch: 'feature',
      commit: 'abc123',
      locked: false,
      prunable: false
    };
    expect(worktree.locked).toBe(false);
  });
});
