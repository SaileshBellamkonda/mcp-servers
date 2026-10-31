import { describe, it, expect } from 'vitest';
import { MarkdownLoader } from '../../../../src/indexer/loaders/markdown.ts';

const loader = new MarkdownLoader();

describe('setext headings', () => {
  it('treats Title over === as a level 1 heading and uses it as the title fallback', () => {
    const doc = loader.load('/x/a.md', 'Title\n=====\n\nbody text');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toMatchObject({
      headingPath: ['Title'],
      text: 'Title\n=====\n\nbody text',
      startLine: 1,
      endLine: 4,
    });
    expect(doc.metadata.title).toBe('Title');
  });

  it('treats Title over --- as a level 2 heading and splits the preceding paragraph into its own section', () => {
    const doc = loader.load('/x/a.md', 'Intro\n\nSub\n---\nbody');
    expect(doc.sections.map((s) => s.headingPath)).toEqual([[], ['Sub']]);
    expect(doc.sections[0]).toMatchObject({ text: 'Intro', startLine: 1, endLine: 1 });
    expect(doc.sections[1]).toMatchObject({ startLine: 3, endLine: 5 });
  });

  it('nests setext headings under ATX headings in the breadcrumb', () => {
    const doc = loader.load('/x/a.md', '# A\n\nSub\n---\n\nbody');
    expect(doc.sections.map((s) => s.headingPath)).toEqual([['A', 'Sub']]);
  });

  it('leaves a thematic break after a blank line as ordinary text', () => {
    const doc = loader.load('/x/a.md', 'para\n\n---\n\nmore');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.headingPath).toEqual([]);
    expect(doc.sections[0]?.text).toContain('---');
  });

  it('does not promote a multi-line paragraph', () => {
    const doc = loader.load('/x/a.md', 'line one\nline two\n---\nafter');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.headingPath).toEqual([]);
  });

  it('does not promote a list item, blockquote or table row', () => {
    for (const first of ['- item', '> quote', '| a | b |']) {
      const doc = loader.load('/x/a.md', `${first}\n---\nafter`);
      expect(doc.sections).toHaveLength(1);
      expect(doc.sections[0]?.headingPath).toEqual([]);
    }
  });

  it('ignores underline-like lines inside fenced code', () => {
    const doc = loader.load('/x/a.md', '```\nTitle\n=====\n```');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.headingPath).toEqual([]);
  });
});
