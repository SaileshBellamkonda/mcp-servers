import { describe, it, expect, beforeEach } from 'vitest';
import { OutputParser } from '../../../src/core/output-parser.js';

describe('OutputParser', () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  describe('parseStatus', () => {
    it('should parse modified unstaged file', () => {
      const output = ' M file.ts';
      const result = parser.parseStatus(output);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'M',
        staged: false,
        unstaged: true
      });
    });

    it('should parse modified staged file', () => {
      const output = 'M  file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'M',
        staged: true,
        unstaged: false
      });
    });

    it('should parse modified staged and unstaged file', () => {
      const output = 'MM file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: 'MM',
        staged: true,
        unstaged: true
      });
    });

    it('should parse untracked file', () => {
      const output = '?? file.ts';
      const result = parser.parseStatus(output);
      expect(result[0]).toEqual({
        path: 'file.ts',
        status: '??',
        staged: false,
        unstaged: true
      });
    });

    it('should parse multiple files', () => {
      const output = ' M file1.ts\nA  file2.ts\n?? file3.ts';
      const result = parser.parseStatus(output);
      expect(result).toHaveLength(3);
    });

    it('should handle empty output', () => {
      const result = parser.parseStatus('');
      expect(result).toEqual([]);
    });
  });

  describe('parseLog', () => {
    it('should parse single commit', () => {
      const output = 'abc123|John Doe|2024-01-01|Initial commit';
      const result = parser.parseLog(output);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        hash: 'abc123',
        author: 'John Doe',
        date: '2024-01-01',
        message: 'Initial commit'
      });
    });

    it('should parse multiple commits', () => {
      const output = 'abc123|John|2024-01-01|First\ndef456|Jane|2024-01-02|Second';
      const result = parser.parseLog(output);
      expect(result).toHaveLength(2);
    });

    it('should handle empty output', () => {
      const result = parser.parseLog('');
      expect(result).toEqual([]);
    });
  });

  describe('parseBranches', () => {
    it('should parse current branch', () => {
      const output = '* main';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'main',
        current: true,
        remote: false
      });
    });

    it('should parse non-current branch', () => {
      const output = '  feature';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'feature',
        current: false,
        remote: false
      });
    });

    it('should parse remote branch', () => {
      const output = '  remotes/origin/main';
      const result = parser.parseBranches(output);
      expect(result[0]).toEqual({
        name: 'origin/main',
        current: false,
        remote: true
      });
    });

    it('should parse multiple branches', () => {
      const output = '* main\n  feature\n  remotes/origin/main';
      const result = parser.parseBranches(output);
      expect(result).toHaveLength(3);
    });
  });

  describe('parseWorktrees', () => {
    it('should parse worktree', () => {
      const output = 'worktree /path/to/worktree\nHEAD abc123\nbranch refs/heads/main';
      const result = parser.parseWorktrees(output);
      expect(result[0]).toEqual({
        path: '/path/to/worktree',
        branch: 'main',
        commit: 'abc123',
        locked: false,
        prunable: false
      });
    });

    it('should parse locked worktree', () => {
      const output = 'worktree /path\nHEAD abc123\nbranch refs/heads/main\nlocked';
      const result = parser.parseWorktrees(output);
      expect(result[0].locked).toBe(true);
    });

    it('should parse prunable worktree', () => {
      const output = 'worktree /path\nHEAD abc123\nbranch refs/heads/main\nprunable';
      const result = parser.parseWorktrees(output);
      expect(result[0].prunable).toBe(true);
    });
  });
});
