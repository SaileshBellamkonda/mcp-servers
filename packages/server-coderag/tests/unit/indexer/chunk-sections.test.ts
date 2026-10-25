import { describe, it, expect } from 'vitest';
import { chunkSections } from '../../../src/indexer/chunk.js';
import type { DocumentSection } from '../../../src/indexer/loaders/types.js';

function section(text: string, startLine = 1, headingPath: string[] = []): DocumentSection {
  return { headingPath, text, startLine, endLine: startLine + text.split('\n').length - 1 };
}

describe('chunkSections', () => {
  it('returns no chunks for no sections', () => {
    expect(chunkSections([], 500)).toEqual([]);
  });

  it('turns a small section into one chunk carrying its heading path and lines', () => {
    const chunks = chunkSections([section('# T\n\nbody', 4, ['T'])], 500);
    expect(chunks).toEqual([
      { content: '# T\n\nbody', position: 0, headingPath: ['T'], startLine: 4, endLine: 6 },
    ]);
  });

  it('numbers positions sequentially across sections', () => {
    const chunks = chunkSections([section('# A\n\none', 1, ['A']), section('# B\n\ntwo', 10, ['B'])], 500);
    expect(chunks.map((c) => c.position)).toEqual([0, 1]);
    expect(chunks.map((c) => c.headingPath)).toEqual([['A'], ['B']]);
  });

  it('packs paragraphs of a large section up to chunkSize on paragraph boundaries', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `paragraph number ${String(i)} with filler text`);
    const text = ['# T', ...paragraphs].join('\n\n');
    const chunks = chunkSections([section(text, 1, ['T'])], 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect([...chunk.content].length).toBeLessThanOrEqual(100);
    }
    const joined = chunks.map((c) => c.content).join('\n\n');
    for (const p of paragraphs) expect(joined).toContain(p);
  });

  it('keeps a fenced code block in one chunk when it fits, even with blank lines inside', () => {
    const fence = '```js\nconst a = 1;\n\nconst b = 2;\n```';
    const text = ['# T', 'intro paragraph one', 'intro paragraph two', fence, 'outro paragraph'].join('\n\n');
    const chunks = chunkSections([section(text, 1, ['T'])], 50);
    const holder = chunks.find((c) => c.content.includes('const a = 1;'));
    expect(holder).toBeDefined();
    expect(holder?.content).toContain('const b = 2;');
    expect(holder?.content.startsWith('```js')).toBe(true);
    expect(holder?.content.endsWith('```')).toBe(true);
  });

  it('splits an oversized fence on line boundaries and re-wraps every piece in the fence', () => {
    const inner = Array.from({ length: 30 }, (_, i) => `line ${String(i + 1).padStart(2, '0')}`);
    const fence = ['```js', ...inner, '```'].join('\n');
    const text = ['# T', 'intro', fence].join('\n\n');
    const chunks = chunkSections([section(text, 1, ['T'])], 60);
    const codeChunks = chunks.filter((c) => c.content.includes('line '));
    expect(codeChunks.length).toBeGreaterThan(1);
    for (const chunk of codeChunks) {
      expect(chunk.content.startsWith('```js')).toBe(true);
      expect(chunk.content.endsWith('```')).toBe(true);
      expect([...chunk.content].length).toBeLessThanOrEqual(60);
    }
    const all = codeChunks.map((c) => c.content).join('\n');
    for (const line of inner) expect(all).toContain(line);
  });

  it('keeps a table together when it fits', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    const text = ['# T', 'x'.repeat(40), table].join('\n\n');
    const chunks = chunkSections([section(text, 1, ['T'])], 50);
    const holder = chunks.find((c) => c.content.includes('| a | b |'));
    expect(holder?.content).toContain('| 1 | 2 |');
    expect(holder?.content).toContain('|---|---|');
  });

  it('reports start and end lines of the blocks in each chunk', () => {
    const chunks = chunkSections([section('para one\n\npara two', 10)], 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ content: 'para one', startLine: 10, endLine: 10 });
    expect(chunks[1]).toMatchObject({ content: 'para two', startLine: 12, endLine: 12 });
  });

  it('splits one oversized prose paragraph and gives the pieces the paragraph line range', () => {
    const paragraph = 'word '.repeat(300).trim();
    const chunks = chunkSections([section(paragraph, 7)], 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect([...chunk.content].length).toBeLessThanOrEqual(201);
      expect(chunk.startLine).toBe(7);
      expect(chunk.endLine).toBe(7);
    }
  });

  it('copies the heading path so chunks do not share one array', () => {
    const path = ['A'];
    const chunks = chunkSections([section('# A\n\nbody', 1, path)], 500);
    expect(chunks[0]?.headingPath).toEqual(['A']);
    expect(chunks[0]?.headingPath).not.toBe(path);
  });
});
