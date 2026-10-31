import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStderrLogger } from '../../../src/core/logger.ts';

describe('createStderrLogger', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('writes one prefixed line per call to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createStderrLogger('coderag');
    logger.debug('d');
    logger.info('i');
    logger.warning('w');
    logger.error('e');
    expect(write.mock.calls.map((c) => c[0])).toEqual([
      '[DEBUG] [coderag] d\n',
      '[INFO] [coderag] i\n',
      '[WARNING] [coderag] w\n',
      '[ERROR] [coderag] e\n',
    ]);
  });

  it('serialises non-string data as JSON', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    createStderrLogger('x').info({ a: 1 });
    expect(write).toHaveBeenCalledWith('[INFO] [x] {"a":1}\n');
  });
});
