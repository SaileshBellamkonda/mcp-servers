import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '../../../src/core/path-validator.ts';
import { RepositoryManager } from '../../../src/core/repository-manager.ts';
import path from 'node:path';
import { GitMcpError, ErrorCode } from '../../../src/core/types.ts';

describe('PathValidator', () => {
  let validator: PathValidator;
  let repoManager: RepositoryManager;

  beforeEach(() => {
    repoManager = new RepositoryManager([path.normalize('/repo')]);
    validator = new PathValidator(repoManager);
  });

  function allowedRepo(): string {
    const [repo] = repoManager.getAllowedRepositories();
    if (repo === undefined) throw new Error('no allowed repository');
    return repo;
  }

  describe('validatePath', () => {
    it('should accept valid relative paths', () => {
      const repo = allowedRepo();
      const result = validator.validatePath(repo, 'src/file.ts');
      expect(result).toBe(path.resolve(repo, 'src/file.ts'));
    });

    it('should accept paths with ./ prefix', () => {
      const repo = allowedRepo();
      const result = validator.validatePath(repo, './src/file.ts');
      expect(result).toBe(path.resolve(repo, 'src/file.ts'));
    });

    it('should accept a path that resolves to the repository root', () => {
      const repo = allowedRepo();
      const result = validator.validatePath(repo, '.');
      expect(result).toBe(path.resolve(repo));
    });

    it('should reject parent directory traversal', () => {
      const repo = allowedRepo();
      expect(() => validator.validatePath(repo, '../outside')).toThrow(GitMcpError);
      expect(() => validator.validatePath(repo, 'src/../../outside')).toThrow(GitMcpError);
    });

    it('should reject home directory expansion', () => {
      const repo = allowedRepo();
      expect(() => validator.validatePath(repo, '~/file')).toThrow(GitMcpError);
    });

    it('should reject absolute paths outside repository', () => {
      const repo = allowedRepo();
      expect(() => validator.validatePath(repo, '/etc/passwd')).toThrow(GitMcpError);
    });

    it('should reject absolute paths to unrelated directories', () => {
      const repo = allowedRepo();
      expect(() => validator.validatePath(repo, '/other/path')).toThrow(GitMcpError);
    });

    it('should throw SECURITY_ERROR for dangerous paths', () => {
      const repo = allowedRepo();
      try {
        validator.validatePath(repo, '../etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });

    it('should throw SECURITY_ERROR for paths outside repository', () => {
      const repo = allowedRepo();
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
      const repo = allowedRepo();
      const paths = ['src/file1.ts', 'src/file2.ts'];
      const results = validator.validatePaths(repo, paths);
      const relativePaths = results.map(r => path.relative(repo, r));
      expect(relativePaths).toHaveLength(2);
    });

    it('should throw if any path is invalid', () => {
      const repo = allowedRepo();
      const paths = ['src/file1.ts', '../outside'];
      expect(() => validator.validatePaths(repo, paths)).toThrow(GitMcpError);
    });

    it('should handle empty array', () => {
      const repo = allowedRepo();
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

describe('PathValidator hardening', () => {
  it('rejects a ".." path segment but accepts ".." inside a file name', () => {
    const rm = new RepositoryManager([path.normalize('/repo')]);
    const v = new PathValidator(rm);
    const [repo = ''] = rm.getAllowedRepositories();
    expect(v.isSafePath('a..b')).toBe(true);
    expect(v.isSafePath('dir/file..bak')).toBe(true);
    expect(v.isSafePath('..')).toBe(false);
    expect(v.isSafePath('../x')).toBe(false);
    expect(v.isSafePath('x/..')).toBe(false);
    expect(v.isSafePath('x/../y')).toBe(false);
    expect(v.isSafePath('x\\..\\y')).toBe(false);
    expect(v.validatePath(repo, 'a..b')).toBe(path.resolve(repo, 'a..b'));
  });
});

describe('PathValidator symlink resolution', () => {
  it('rejects paths that escape the repository through a symlink, even for non-existent leaves', async () => {
    const { mkdtemp, mkdir, symlink, writeFile, rm, realpath } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const base = await realpath(await mkdtemp(path.join(tmpdir(), 'pv-sym-')));
    try {
      const repo = path.join(base, 'repo');
      const outside = path.join(base, 'outside');
      await mkdir(repo);
      await mkdir(outside);
      await writeFile(path.join(outside, 'secret.txt'), 's');
      await mkdir(path.join(repo, 'real'));
      await symlink(outside, path.join(repo, 'link'));
      await symlink(path.join(repo, 'real'), path.join(repo, 'inner-link'));
      const v = new PathValidator(new RepositoryManager([repo]));

      expect(() => v.validatePath(repo, 'link/secret.txt')).toThrow(GitMcpError);
      expect(() => v.validatePath(repo, 'link/not-yet/created.txt')).toThrow(GitMcpError);
      expect(() => v.validatePath(repo, 'link')).toThrow(GitMcpError);
      // Symlinks that stay inside the repository, and ordinary paths, keep working.
      expect(v.validatePath(repo, 'inner-link/new.txt')).toBe(path.join(repo, 'inner-link', 'new.txt'));
      expect(v.validatePath(repo, 'real/new.txt')).toBe(path.join(repo, 'real', 'new.txt'));
      expect(v.validatePath(repo, 'missing/dir/file.txt')).toBe(path.join(repo, 'missing', 'dir', 'file.txt'));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
