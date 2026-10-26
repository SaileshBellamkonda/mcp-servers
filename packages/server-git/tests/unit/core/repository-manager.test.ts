import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const normalize = (s: string) => path.normalize(s);

describe('RepositoryManager', () => {
  let manager: RepositoryManager;

  beforeEach(() => {
    manager = new RepositoryManager(['/repo1', '/repo2']);
  });

  describe('getAllowedRepositories', () => {
    it('should return all allowed repositories', () => {
      const repos = manager.getAllowedRepositories().map(normalize);
      expect(repos).toEqual(['/repo1', '/repo2'].map(normalize));
    });

    it('should return empty array when no repositories configured', () => {
      const emptyManager = new RepositoryManager([]);
      expect(emptyManager.getAllowedRepositories()).toEqual([]);
    });
  });

  describe('isRepositoryAllowed', () => {
    it('should return true for allowed repository', () => {
      expect(manager.isRepositoryAllowed('/repo1')).toBe(true);
      expect(manager.isRepositoryAllowed('/repo2')).toBe(true);
    });

    it('should return false for disallowed repository', () => {
      expect(manager.isRepositoryAllowed('/repo3')).toBe(false);
      expect(manager.isRepositoryAllowed('/etc/passwd')).toBe(false);
    });

    it('should normalize paths before checking', () => {
      expect(manager.isRepositoryAllowed('/repo1/')).toBe(true);
      expect(manager.isRepositoryAllowed('/repo1/.')).toBe(true);
    });
  });

  describe('validateRepository', () => {
    it('should return normalized path for allowed repository', () => {
      const result = manager.validateRepository('/repo1');
      expect(normalize(result)).toBe(normalize('/repo1'));
    });

    it('should throw error for disallowed repository', () => {
      expect(() => manager.validateRepository('/repo3')).toThrow(GitMcpError);
      expect(() => manager.validateRepository('/repo3')).toThrow('not allowed');
    });

    it('should throw error with SECURITY_ERROR code', () => {
      try {
        manager.validateRepository('/etc/passwd');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.SECURITY_ERROR);
      }
    });
  });

  describe('updateAllowedRepositories', () => {
    it('should update the list of allowed repositories', () => {
      manager.updateAllowedRepositories(['/repo3', '/repo4']);
      const repos = manager.getAllowedRepositories().map(normalize);
      expect(repos).toEqual(['/repo3', '/repo4'].map(normalize));
    });

    it('should allow empty list', () => {
      manager.updateAllowedRepositories([]);
      expect(manager.getAllowedRepositories()).toEqual([]);
    });
  });

  describe('validateRepository returns normalized path', () => {
    it('should normalize trailing slashes on validate', () => {
      const result = manager.validateRepository('/repo1/');
      expect(normalize(result)).toBe(normalize('/repo1'));
    });

    it('should normalize dot segments on validate', () => {
      const result = manager.validateRepository('/repo1/.');
      expect(normalize(result)).toBe(normalize('/repo1'));
    });

    it('should not double-normalize already-normalized paths', () => {
      const first = manager.validateRepository('/repo1');
      const second = manager.validateRepository(first);
      expect(first).toBe(second);
    });
  });

  describe('real-path validation', () => {
    let dir: string;
    let real: string;

    beforeEach(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-mgr-')));
      real = path.join(dir, 'real');
      fs.mkdirSync(real);
      fs.mkdirSync(path.join(dir, 'other'));
      fs.symlinkSync(path.join(dir, 'other'), path.join(real, 'lnk'));
      fs.symlinkSync(real, path.join(dir, 'rootlink'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects any ".." segment, even when it would resolve to an allowed repo', () => {
      const m = new RepositoryManager([real]);
      expect(() => m.validateRepository(path.join(real, 'sub') + path.sep + '..')).toThrow(GitMcpError);
      expect(() => m.validateRepository(`${real}${path.sep}lnk${path.sep}..`)).toThrow(GitMcpError);
      expect(m.isRepositoryAllowed(`${real}${path.sep}lnk${path.sep}..`)).toBe(false);
    });

    it('refuses a symlink that points outside the allowed repository', () => {
      const m = new RepositoryManager([real]);
      expect(() => m.validateRepository(path.join(real, 'lnk'))).toThrow('not allowed');
    });

    it('returns the real path for a symlinked allowed root', () => {
      const m = new RepositoryManager([path.join(dir, 'rootlink')]);
      expect(m.validateRepository(path.join(dir, 'rootlink'))).toBe(real);
      expect(m.validateRepository(real)).toBe(real);
    });

    it('accepts trailing slash and dot and returns the clean real path', () => {
      const m = new RepositoryManager([real]);
      expect(m.validateRepository(real + path.sep)).toBe(real);
      expect(m.validateRepository(path.join(real, '.'))).toBe(real);
    });

    it('resolves relative inputs against the process cwd', () => {
      const m = new RepositoryManager([real]);
      const rel = path.relative(process.cwd(), real);
      if (!rel.split(path.sep).includes('..')) {
        expect(m.validateRepository(rel)).toBe(real);
      } else {
        expect(() => m.validateRepository(rel)).toThrow(GitMcpError);
      }
      expect(() => m.validateRepository('real')).toThrow('not allowed');
    });

    it('tolerates allowed entries that do not exist yet and picks them up once they do', () => {
      const later = path.join(dir, 'later');
      const m = new RepositoryManager([later]);
      expect(m.validateRepository(later)).toBe(later);
      fs.mkdirSync(later);
      expect(m.validateRepository(later)).toBe(later);
    });

    it.skipIf(process.platform !== 'win32')('compares case-insensitively on win32', () => {
      const m = new RepositoryManager([real]);
      expect(m.isRepositoryAllowed(real.toUpperCase())).toBe(true);
    });
  });
});
