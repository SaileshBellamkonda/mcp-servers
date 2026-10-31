import { describe, it, expect } from 'vitest';
import { MarkdownLoader } from '../../../../src/indexer/loaders/markdown.ts';

const loader = new MarkdownLoader();

describe('MarkdownLoader', () => {
  it('declares the markdown extensions', () => {
    expect(loader.name).toBe('markdown');
    expect([...loader.extensions]).toEqual(['.md', '.markdown']);
  });

  it('strips frontmatter from sections and normalizes it into metadata', () => {
    const source = [
      '---',
      'title: My Doc',
      'tags: [Auth, "API"]',
      'domain: backend',
      'doc_type: guide',
      'project: acme',
      'language: typescript',
      'custom: 5',
      '---',
      '# Heading',
      '',
      'Body text.',
    ].join('\n');
    const doc = loader.load('/x/guide.md', source);

    expect(doc.metadata).toEqual({
      title: 'My Doc',
      tags: ['auth', 'api'],
      docType: 'guide',
      domain: 'backend',
      project: 'acme',
      language: 'typescript',
      extra: { custom: 5 },
    });
    expect(doc.sections).toHaveLength(1);
    const section = doc.sections[0];
    expect(section?.text).toContain('# Heading');
    expect(section?.text).toContain('Body text.');
    expect(section?.text).not.toContain('title:');
    expect(section?.startLine).toBe(10);
    expect(section?.endLine).toBe(12);
  });

  it('accepts tags as a comma-separated string, trimmed, lower-cased and de-duplicated', () => {
    const doc = loader.load('/x/a.md', '---\ntags: "a, B ,c, a"\n---\n# T\nbody');
    expect(doc.metadata.tags).toEqual(['a', 'b', 'c']);
  });

  it('uses the frontmatter title first', () => {
    const doc = loader.load('/x/a.md', '---\ntitle: From Meta\n---\n# From Heading\nbody');
    expect(doc.metadata.title).toBe('From Meta');
  });

  it('falls back to the first H1, then to the file basename', () => {
    expect(loader.load('/x/a.md', '## Sub\ntext\n# First\ntext').metadata.title).toBe('First');
    expect(loader.load('/x/notes.md', 'just some text').metadata.title).toBe('notes');
  });

  it('does not treat # inside fenced code as a heading', () => {
    const source = ['# A', '', '```bash', '# not a heading', '```', '', '## B', '', 'text'].join('\n');
    const doc = loader.load('/x/a.md', source);
    expect(doc.sections.map((s) => s.headingPath)).toEqual([['A'], ['A', 'B']]);
    expect(doc.sections[0]?.text).toContain('# not a heading');
  });

  it('honours tilde fences closed by a longer run', () => {
    const source = ['~~~', '# inside', '~~~~', '# Real', 'body'].join('\n');
    const doc = loader.load('/x/a.md', source);
    expect(doc.sections.map((s) => s.headingPath)).toEqual([[], ['Real']]);
    expect(doc.sections[0]?.text).toContain('# inside');
  });

  it('builds breadcrumbs for nested headings and drops heading-only sections', () => {
    const source = [
      '# A',
      '',
      '## B',
      '',
      'text b',
      '',
      '### C',
      '',
      'text c',
      '',
      '## D',
      '',
      'text d',
    ].join('\n');
    const doc = loader.load('/x/a.md', source);
    expect(doc.sections.map((s) => s.headingPath)).toEqual([
      ['A', 'B'],
      ['A', 'B', 'C'],
      ['A', 'D'],
    ]);
  });

  it('keeps existing ancestors when the heading level jumps', () => {
    const doc = loader.load('/x/a.md', '# A\nx\n### C\ny');
    expect(doc.sections.map((s) => s.headingPath)).toEqual([['A'], ['A', 'C']]);
  });

  it('keeps content before the first heading as a section with an empty path', () => {
    const doc = loader.load('/x/a.md', 'intro\n\n# A\nbody');
    expect(doc.sections[0]).toMatchObject({ headingPath: [], text: 'intro', startLine: 1, endLine: 1 });
    expect(doc.sections[1]?.headingPath).toEqual(['A']);
  });

  it('returns no sections for an empty file', () => {
    expect(loader.load('/x/empty.md', '').sections).toEqual([]);
    expect(loader.load('/x/blank.md', '\n  \n').sections).toEqual([]);
  });

  it('treats malformed YAML frontmatter as plain body', () => {
    const source = '---\ntitle: [unclosed\n---\n# H\nbody';
    let doc;
    expect(() => {
      doc = loader.load('/x/a.md', source);
    }).not.toThrow();
    expect(doc).toBeDefined();
    const loaded = loader.load('/x/a.md', source);
    expect(loaded.metadata.tags).toEqual([]);
    expect(loaded.metadata.title).toBe('H');
    expect(loaded.sections.some((s) => s.text.includes('# H'))).toBe(true);
  });

  it('treats scalar frontmatter as plain body', () => {
    const loaded = loader.load('/x/a.md', '---\njust text\n---\n# H\nbody');
    expect(loaded.metadata.tags).toEqual([]);
    expect(loaded.sections.some((s) => s.text.includes('just text'))).toBe(true);
  });

  it('normalizes CRLF line endings', () => {
    const doc = loader.load('/x/a.md', '# A\r\n\r\ntext\r\n');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.text).not.toContain('\r');
    expect(doc.sections[0]?.endLine).toBe(3);
  });
});
