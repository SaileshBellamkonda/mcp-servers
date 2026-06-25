import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '../../../src/core/path-validator.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import path from 'node:path';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('PathValidator', () => {
  let validator: PathValidator;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    repoManager = new RepositoryManager([path.normalize('/repo')]);
    validator = new PathValidator(repoManager);
  });

  describe('validatePath', () => {
    it('should accept valid relative paths', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const result = validator.validatePath(repo, 'src/file.ts');
      expect(result).toBe(path.resolve(repo, 'src/file.ts'));
    });

    it('should accept paths with ./ prefix', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const result = validator.validatePath(repo, './src/file.ts');
      expect(result).toBe(path.resolve(repo, 'src/file.ts'));
    });

    it('should accept a path that resolves to the repository root', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const result = validator.validatePath(repo, '.');
      expect(result).toBe(path.resolve(repo));
    });

    it('should reject parent directory traversal', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      expect(() => validator.validatePath(repo, '../outside')).toThrow(GitMcpError);
      expect(() => validator.validatePath(repo, 'src/../../outside')).toThrow(GitMcpError);
    });

    it('should reject home directory expansion', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      expect(() => validator.validatePath(repo, '~/file')).toThrow(GitMcpError);
    });

    it('should reject absolute paths outside repository', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      expect(() => validator.validatePath(repo, '/etc/passwd')).toThrow(GitMcpError);
    });

    it('should reject absolute paths to unrelated directories', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      expect(() => validator.validatePath(repo, '/other/path')).toThrow(GitMcpError);
    });

    it('should throw SECURITY_ERROR for dangerous paths', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      try {
        validator.validatePath(repo, '../etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });

    it('should throw SECURITY_ERROR for paths outside repository', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      try {
        validator.validatePath(repo, '/other/path');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });
  });

  describe('validatePaths', () => {
    it('should validate multiple paths', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const paths = ['src/file1.ts', 'src/file2.ts'];
      const results = validator.validatePaths(repo, paths);
      const relativePaths = results.map(r => path.relative(repo, r));
      expect(relativePaths).toHaveLength(2);
    });

    it('should throw if any path is invalid', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const paths = ['src/file1.ts', '../outside'];
      expect(() => validator.validatePaths(repo, paths)).toThrow(GitMcpError);
    });

    it('should handle empty array', () => {
      const repo = repoManager.getAllowedRepositories()[0];
      const results = validator.validatePaths(repo, []);
      expect(results).toEqual([]);
    });
  });

  describe('isSafePath', () => {
    it('should return true for safe paths', () => {
      expect(validator.isSafePath('src/file.ts')).toBe(true);
      expect(validator.isSafePath('./src/file.ts')).toBe(true);
      expect(validator.isSafePath('file.ts')).toBe(true);
    });

    it('should return false for dangerous patterns', () => {
      expect(validator.isSafePath('../outside')).toBe(false);
      expect(validator.isSafePath('~/file')).toBe(false);
      expect(validator.isSafePath('/etc/passwd')).toBe(false);
    });
  });
});
