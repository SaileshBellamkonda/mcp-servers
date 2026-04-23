import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '../../../src/core/path-validator.js';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('PathValidator', () => {
  let validator: PathValidator;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    repoManager = new RepositoryManager(['/repo']);
    validator = new PathValidator(repoManager);
  });

  describe('validatePath', () => {
    it('should accept valid relative paths', () => {
      const result = validator.validatePath('/repo', 'src/file.ts');
      expect(result).toContain('src');
      expect(result).toContain('file.ts');
    });

    it('should accept paths with ./ prefix', () => {
      const result = validator.validatePath('/repo', './src/file.ts');
      expect(result).toContain('src');
      expect(result).toContain('file.ts');
    });

    it('should reject parent directory traversal', () => {
      expect(() => validator.validatePath('/repo', '../outside')).toThrow(GitMcpError);
      expect(() => validator.validatePath('/repo', 'src/../../outside')).toThrow(GitMcpError);
    });

    it('should reject home directory expansion', () => {
      expect(() => validator.validatePath('/repo', '~/file')).toThrow(GitMcpError);
    });

    it('should reject absolute paths outside repository', () => {
      expect(() => validator.validatePath('/repo', '/etc/passwd')).toThrow(GitMcpError);
    });

    it('should throw SECURITY_ERROR for dangerous paths', () => {
      try {
        validator.validatePath('/repo', '../etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });
  });

  describe('validatePaths', () => {
    it('should validate multiple paths', () => {
      const paths = ['src/file1.ts', 'src/file2.ts'];
      const results = validator.validatePaths('/repo', paths);
      expect(results).toHaveLength(2);
    });

    it('should throw if any path is invalid', () => {
      const paths = ['src/file1.ts', '../outside'];
      expect(() => validator.validatePaths('/repo', paths)).toThrow(GitMcpError);
    });

    it('should handle empty array', () => {
      const results = validator.validatePaths('/repo', []);
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
