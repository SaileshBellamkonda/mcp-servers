import { describe, it, expect } from 'vitest';
import { matchFenceOpen, isFenceClose } from '../../../../src/indexer/loaders/fence.ts';

describe('matchFenceOpen', () => {
  it('recognises backtick fences with an info string', () => {
    expect(matchFenceOpen('```ts')).toEqual({ char: '`', len: 3 });
  });

  it('recognises tilde fences and records their length', () => {
    expect(matchFenceOpen('~~~~')).toEqual({ char: '~', len: 4 });
  });

  it('allows up to three spaces of indentation', () => {
    expect(matchFenceOpen('   ```')).toEqual({ char: '`', len: 3 });
    expect(matchFenceOpen('    ```')).toBeNull();
  });

  it('rejects backtick fences whose info string contains a backtick (inline code)', () => {
    expect(matchFenceOpen('```a`b')).toBeNull();
    expect(matchFenceOpen('```code```')).toBeNull();
  });

  it('returns null for ordinary text', () => {
    expect(matchFenceOpen('plain text')).toBeNull();
    expect(matchFenceOpen('``')).toBeNull();
  });
});

describe('isFenceClose', () => {
  const backticks = { char: '`', len: 3 };

  it('closes with the same character and at least the opening length', () => {
    expect(isFenceClose('```', backticks)).toBe(true);
    expect(isFenceClose('````', backticks)).toBe(true);
    expect(isFenceClose('```   ', backticks)).toBe(true);
  });

  it('does not close with a shorter run, another character, or trailing text', () => {
    expect(isFenceClose('``', backticks)).toBe(false);
    expect(isFenceClose('~~~', backticks)).toBe(false);
    expect(isFenceClose('``` trailing', backticks)).toBe(false);
  });
});
