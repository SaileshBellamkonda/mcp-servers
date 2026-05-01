import { describe, it, expect, beforeEach } from 'vitest';
import { RepositoryManager } from '../../../src/core/repository-manager.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';
import path from 'node:path';

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
});
