import { describe, it, expect } from 'vitest';
import { matchFenceOpen, isFenceClose } from '../../../../src/indexer/loaders/fence.js';

describe('fence helpers with CRLF line endings', () => {
  it('recognises an opening fence that still has its trailing carriage return', () => {
    expect(matchFenceOpen('```ts\r')).toEqual({ char: '`', len: 3 });
    expect(matchFenceOpen('~~~\r')).toEqual({ char: '~', len: 3 });
  });

  it('recognises a closing fence that still has its trailing carriage return', () => {
    expect(isFenceClose('```\r', { char: '`', len: 3 })).toBe(true);
    expect(isFenceClose('``` \r', { char: '`', len: 3 })).toBe(true);
  });

  it('still rejects inline code and short runs', () => {
    expect(matchFenceOpen('```code```\r')).toBeNull();
    expect(isFenceClose('``\r', { char: '`', len: 3 })).toBe(false);
  });
});
