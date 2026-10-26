import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from '../../src/index.js';

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.0.0.2', '127.255.255.255', 'localhost', 'LOCALHOST', '::1', '[::1]', ' 127.0.0.1 '])(
    'accepts %j',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    '0.0.0.0',
    '::',
    '[::]',
    '',
    '192.168.1.10',
    '10.0.0.1',
    '126.255.255.255',
    '128.0.0.1',
    '127.0.0',
    '127.0.0.1.5',
    '127.0.0.256',
    '127.0.0.x',
    'example.com',
    'localhost.example.com',
    'foo.localhost',
    '::2',
    '::ffff:192.168.0.1',
  ])('rejects %j', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
