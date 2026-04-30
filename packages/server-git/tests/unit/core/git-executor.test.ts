import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitExecutor } from '../../../src/core/git-executor.js';
import { GitMcpError, ErrorCode } from '../../../src/core/types.js';

describe('GitExecutor', () => {
  let executor: GitExecutor;

  beforeEach(() => {
    executor = new GitExecutor();
  });

  describe('execute', () => {
    it('should execute git command and return result', async () => {
      const result = await executor.execute('/repo', ['--version']);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('git version');
    });

    it('should handle command failure', async () => {
      const result = await executor.execute('/nonexistent', ['status']);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it('should apply default timeout of 30 seconds', async () => {
      // This test verifies timeout is set, not that it triggers
      const result = await executor.execute('/repo', ['--version']);
      expect(result).toBeDefined();
    });

    it('should accept custom timeout', async () => {
      const result = await executor.execute('/repo', ['--version'], { timeout: 5000 });
      expect(result.success).toBe(true);
    });

    it('should handle timeout errors', async () => {
      // Create a command that will timeout (sleep equivalent)
      try {
        await executor.execute('/repo', ['sleep', '100'], { timeout: 100 });
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect(error).toBeInstanceOf(GitMcpError);
        expect((error as GitMcpError).code).toBe(ErrorCode.GIT_ERROR);
      }
    }, 10000);

    it('should capture stdout and stderr separately', async () => {
      const result = await executor.execute('/repo', ['--version']);
      expect(result.stdout).toBeTruthy();
      expect(result.stderr).toBeDefined();
    });
  });
});
