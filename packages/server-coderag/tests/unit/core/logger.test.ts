import { describe, it, expect, vi, afterEach } from 'vitest';
import { silentLogger } from '../../../src/core/logger.ts';

describe('silentLogger', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts every level and writes nothing to stderr or stdout', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    silentLogger.debug('d');
    silentLogger.info('i');
    silentLogger.warning('w');
    silentLogger.error('e');
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});
