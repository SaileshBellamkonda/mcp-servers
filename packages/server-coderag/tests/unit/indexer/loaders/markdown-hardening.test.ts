import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import { MarkdownLoader } from '../../../../src/indexer/loaders/markdown.js';

const loader = new MarkdownLoader();
const globals = globalThis as Record<string, unknown>;

describe('frontmatter is YAML only', () => {
  it('does not execute ---js frontmatter and keeps the file as body text', () => {
    delete globals['__pwned'];
    const source = '---js\n(globalThis.__pwned = "code ran", { title: "x" })\n---\n# H\nbody';
    const doc = loader.load('/x/evil.md', source);
    expect(globals['__pwned']).toBeUndefined();
    expect(doc.sections.some((s) => s.text.includes('# H'))).toBe(true);
  });

  it('does not execute ---javascript frontmatter either', () => {
    delete globals['__pwned'];
    const source = '---javascript\n(globalThis.__pwned = "code ran", { title: "x" })\n---\n# H\nbody';
    expect(() => loader.load('/x/evil.md', source)).not.toThrow();
    expect(globals['__pwned']).toBeUndefined();
  });

  it('still parses ordinary YAML frontmatter', () => {
    const doc = loader.load('/x/a.md', '---\ntitle: Real\ntags: [a]\n---\n# H\nbody');
    expect(doc.metadata.title).toBe('Real');
    expect(doc.metadata.tags).toEqual(['a']);
  });
});

describe('gray-matter cache', () => {
  it('does not retain loaded documents in the global cache', () => {
    const cache = matter.cache as Record<string, unknown>;
    const before = Object.keys(cache).length;
    for (let i = 0; i < 50; i++) {
      loader.load('/x/a.md', `---\ntitle: Doc ${String(i)}\n---\n# H\nbody ${String(i)}`);
    }
    expect(Object.keys(cache).length).toBe(before);
  });

  it('returns independent metadata for identical sources', () => {
    const source = '---\ntags: [one]\n---\n# H\nbody';
    const first = loader.load('/x/a.md', source);
    first.metadata.tags.push('mutated');
    expect(loader.load('/x/a.md', source).metadata.tags).toEqual(['one']);
  });
});

describe('unterminated frontmatter', () => {
  it('treats a leading --- with no closing --- as body text', () => {
    const doc = loader.load('/x/a.md', '---\n# H\nbody: x\n');
    expect(doc.metadata.extra).toEqual({});
    expect(doc.sections.some((s) => s.text.includes('# H'))).toBe(true);
    expect(doc.sections.some((s) => s.text.includes('body: x'))).toBe(true);
  });

  it('accepts frontmatter that ends the file without a trailing newline', () => {
    const doc = loader.load('/x/a.md', '---\ntitle: Only\n---');
    expect(doc.metadata.title).toBe('Only');
    expect(doc.sections).toEqual([]);
  });
});

describe('extra frontmatter is bounded', () => {
  it('drops a YAML alias bomb but keeps ordinary extra keys', () => {
    const lines = ['a0: &a0 [x, x, x, x, x, x, x, x, x]'];
    for (let i = 1; i <= 7; i++) {
      lines.push(`a${String(i)}: &a${String(i)} [${Array<string>(9).fill(`*a${String(i - 1)}`).join(', ')}]`);
    }
    lines.push('custom: 5');
    const doc = loader.load('/x/a.md', `---\n${lines.join('\n')}\n---\n# H\nbody`);
    expect(doc.metadata.extra['custom']).toBe(5);
    expect(doc.metadata.extra['a7']).toBeUndefined();
    expect(JSON.stringify(doc.metadata.extra).length).toBeLessThan(20000);
  });

  it('drops a self-referential value without throwing', () => {
    const doc = loader.load('/x/a.md', '---\nx: &a [*a]\ncustom: 1\n---\n# H\nbody');
    expect(doc.metadata.extra['x']).toBeUndefined();
    expect(doc.metadata.extra['custom']).toBe(1);
    expect(() => JSON.stringify(doc.metadata.extra)).not.toThrow();
  });
});

describe('ATX headings', () => {
  it('parses a heading with a very long whitespace run in linear time', () => {
    const started = performance.now();
    const doc = loader.load('/x/a.md', `# a${' '.repeat(100000)}b\n\ntext`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(doc.sections[0]?.headingPath).toHaveLength(1);
  });

  it('strips an optional closing hash sequence but keeps a trailing # that is part of the text', () => {
    expect(loader.load('/x/a.md', '## Title ##\nbody').sections[0]?.headingPath).toEqual(['Title']);
    expect(loader.load('/x/a.md', '# C#\nbody').sections[0]?.headingPath).toEqual(['C#']);
  });

  it('does not treat a heading with no text as a heading', () => {
    const doc = loader.load('/x/a.md', '# A\n\ntext\n\n##   \n\nmore');
    expect(doc.sections.map((s) => s.headingPath)).toEqual([['A']]);
    expect(doc.sections[0]?.text).toContain('more');
  });
});
