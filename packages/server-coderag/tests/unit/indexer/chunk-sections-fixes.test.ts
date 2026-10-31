import { describe, it, expect } from 'vitest';
import { chunkSections, splitIntoChunks } from '../../../src/indexer/chunk.ts';
import type { DocumentSection } from '../../../src/indexer/loaders/types.ts';

function section(text: string, startLine = 1, headingPath: string[] = []): DocumentSection {
  return { headingPath, text, startLine, endLine: startLine + text.split('\n').length - 1 };
}

describe('prose pieces report their own lines', () => {
  it('gives every piece of a long multi-line paragraph the lines it actually contains', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Line ${String(i + 1)} sentence about topics.`);
    const text = ['# H', '', ...lines].join('\n');
    const chunks = chunkSections([section(text, 1, ['H'])], 120);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const numbers = [...chunk.content.matchAll(/Line (\d+)/g)].map((m) => Number(m[1]));
      if (numbers.length === 0) continue;
      const expectedStart = chunk.content.startsWith('# H') ? 1 : Math.min(...numbers) + 2;
      expect(chunk.startLine).toBe(expectedStart);
      expect(chunk.endLine).toBe(Math.max(...numbers) + 2);
    }
  });
});

describe('large prose blocks are split in linear time', () => {
  it('chunks 12k lines without blank lines quickly', () => {
    const text = Array.from({ length: 12000 }, (_, i) => `Line ${String(i)} sentence about topics.`).join('\n');
    const started = performance.now();
    const chunks = chunkSections([section(text)], 500);
    expect(performance.now() - started).toBeLessThan(10000);
    expect(chunks.length).toBeGreaterThan(100);
  });

  it('splits one very long line quickly and keeps every piece within the limit', () => {
    const text = 'word '.repeat(200000).trim();
    const started = performance.now();
    const chunks = chunkSections([section(text)], 200);
    expect(performance.now() - started).toBeLessThan(10000);
    for (const chunk of chunks) {
      expect([...chunk.content].length).toBeLessThanOrEqual(201);
    }
    expect(chunks.map((c) => c.content).join(' ').replace(/\s+/g, ' ').length).toBeGreaterThan(900000);
  });

  it('splitIntoChunks handles a long unbroken paragraph quickly too', () => {
    const started = performance.now();
    const chunks = splitIntoChunks('word '.repeat(100000).trim(), 200);
    expect(performance.now() - started).toBeLessThan(10000);
    expect(chunks.length).toBeGreaterThan(1000);
  });
});

describe('tiny sections are merged', () => {
  it('merges adjacent tiny sibling sections and widens the line range', () => {
    const chunks = chunkSections(
      [section('## B\n\nshort one', 3, ['A', 'B']), section('## C\n\nshort two', 7, ['A', 'C'])],
      500,
    );
    expect(chunks).toEqual([
      {
        content: '## B\n\nshort one\n\n## C\n\nshort two',
        position: 0,
        headingPath: ['A'],
        startLine: 3,
        endLine: 9,
      },
    ]);
  });

  it('keeps merging while the accumulated chunk is still tiny, then renumbers positions', () => {
    const chunks = chunkSections(
      [
        section('## B\n\none', 1, ['A', 'B']),
        section('## C\n\ntwo', 5, ['A', 'C']),
        section('## D\n\nthree', 9, ['A', 'D']),
        section('# X\n\nother', 13, ['X']),
      ],
      500,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain('## D');
    expect(chunks[0]?.headingPath).toEqual(['A']);
    expect(chunks.map((c) => c.position)).toEqual([0, 1]);
  });

  it('does not merge sections under different top-level headings', () => {
    const chunks = chunkSections([section('## B\n\nx', 1, ['A', 'B']), section('## Y\n\ny', 5, ['X', 'Y'])], 500);
    expect(chunks).toHaveLength(2);
  });

  it('does not merge content that has no heading', () => {
    const chunks = chunkSections([section('intro', 1, []), section('# A\n\nx', 3, ['A'])], 500);
    expect(chunks).toHaveLength(2);
  });

  it('does not merge when the combined text would exceed the chunk size', () => {
    const big = `## C\n\n${'y'.repeat(90)}`;
    const chunks = chunkSections([section('## B\n\nx', 1, ['A', 'B']), section(big, 5, ['A', 'C'])], 100);
    expect(chunks).toHaveLength(2);
  });

  it('does not merge when the earlier chunk is not tiny', () => {
    const medium = `## B\n\n${'x'.repeat(30)}`;
    const chunks = chunkSections([section(medium, 1, ['A', 'B']), section('## C\n\ny', 6, ['A', 'C'])], 100);
    expect(chunks).toHaveLength(2);
  });

  it('never merges pieces of a split section', () => {
    const longPart = Array.from({ length: 30 }, (_, i) => `sentence number ${String(i)} here`).join('\n\n');
    const chunks = chunkSections(
      [section('## B\n\nx', 1, ['A', 'B']), section(`## C\n\n${longPart}`, 5, ['A', 'C'])],
      100,
    );
    expect(chunks[0]?.content).toBe('## B\n\nx');
    expect(chunks.length).toBeGreaterThan(3);
  });
});
