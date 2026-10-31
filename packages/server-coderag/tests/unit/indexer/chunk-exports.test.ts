import { describe, it, expect } from 'vitest';
import * as chunk from '../../../src/indexer/chunk.ts';

describe('chunk module exports', () => {
  it('no longer exposes the file-reading markdown parser', () => {
    expect('parseMarkdownFile' in chunk).toBe(false);
  });

  it('still exposes the chunkers', () => {
    expect(typeof chunk.splitIntoChunks).toBe('function');
    expect(typeof chunk.chunkSections).toBe('function');
  });
});
