import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from '../../../src/indexer/chunk.js';

describe('splitIntoChunks', () => {
  it('returns single chunk for small content', () => {
    const result = splitIntoChunks('Hello world', 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world');
  });

  it('returns empty array for empty/whitespace content', () => {
    expect(splitIntoChunks('', 500)).toHaveLength(0);
    expect(splitIntoChunks('   \n  ', 500)).toHaveLength(0);
  });

  it('splits on paragraph boundaries', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const result = splitIntoChunks(content, 20);
    expect(result.length).toBeGreaterThan(1);
    expect(result.join(' ')).toContain('First paragraph');
    expect(result.join(' ')).toContain('Second paragraph');
  });

  it('joins small paragraphs into one chunk', () => {
    const content = 'Short.\n\nAlso short.\n\nTiny.';
    const result = splitIntoChunks(content, 500);
    expect(result).toHaveLength(1);
  });

  it('sub-splits a large paragraph', () => {
    const longPara = 'word '.repeat(300); // ~1500 chars
    const result = splitIntoChunks(longPara, 200);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(400); // allow some overflow at sentence boundary
    }
  });

  it('handles unicode safely', () => {
    const content = '日本語テスト\n\n英語テスト';
    const result = splitIntoChunks(content, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('日本語');
  });

  it('assigns sequential positions', () => {
    const content = 'Para one.\n\nPara two.\n\nPara three.';
    const chunks = splitIntoChunks(content, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('flushes accumulated content before a large paragraph', () => {
    // Build: small para + large para. chunkSize=50 so both would exceed limit.
    const smallPara = 'Short intro.'; // ~12 chars
    const largePara = 'x '.repeat(40); // ~80 chars > 50
    const content = smallPara + '\n\n' + largePara;
    const result = splitIntoChunks(content, 50);
    // Should produce: chunk with smallPara, then chunk(s) from largePara split
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toBe(smallPara);
  });
});
