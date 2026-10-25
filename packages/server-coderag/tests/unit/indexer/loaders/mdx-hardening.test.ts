import { describe, it, expect } from 'vitest';
import { MdxLoader, stripMdx } from '../../../../src/indexer/loaders/mdx.js';

const loader = new MdxLoader();

const SOURCE = [
  '# Setup',
  '',
  'Install it:',
  '',
  '```tsx',
  'import React from "react";',
  'export const App = () => <Foo bar="1" />;',
  '# comment',
  '```',
  '',
  'Done.',
  '',
].join('\n');

describe('CRLF mdx', () => {
  it('produces the same sections for CRLF and LF sources, keeping fenced code intact', () => {
    const lf = loader.load('/x/a.mdx', SOURCE);
    const crlf = loader.load('/x/a.mdx', SOURCE.replace(/\n/g, '\r\n'));
    expect(crlf.sections).toEqual(lf.sections);
    expect(crlf.sections[0]?.text).toContain('import React from "react";');
    expect(crlf.sections[0]?.text).toContain('# comment');
  });

  it('keeps frontmatter line offsets identical for CRLF', () => {
    const withFrontmatter = `---\ntitle: T\n---\n${SOURCE}`;
    const lf = loader.load('/x/a.mdx', withFrontmatter);
    const crlf = loader.load('/x/a.mdx', withFrontmatter.replace(/\n/g, '\r\n'));
    expect(crlf.sections).toEqual(lf.sections);
    expect(crlf.metadata.title).toBe('T');
  });
});

describe('inline code and prose are not mangled', () => {
  it('keeps self-closing JSX that appears inside inline code', () => {
    expect(stripMdx('Use `<Button />` here')).toBe('Use `<Button />` here');
    expect(stripMdx('| `<Foo />` | desc |')).toBe('| `<Foo />` | desc |');
  });

  it('still removes real self-closing JSX next to inline code', () => {
    expect(stripMdx('See `code` and <Badge text="new" /> now')).toBe('See `code` and  now');
  });

  it('does not treat a prose paragraph starting with "import ... from" as ESM', () => {
    const prose = 'import data from the cache';
    expect(stripMdx(prose)).toBe(prose);
    expect(stripMdx(`${prose}\nmore prose`)).toBe(`${prose}\nmore prose`);
  });

  it('still blanks a real import with a quoted module', () => {
    expect(stripMdx("import Foo from './foo'\n\nprose")).toBe('\n\nprose');
    expect(stripMdx("import x, { y } from 'z'\n\nprose")).toBe('\n\nprose');
  });

  it('does not start a comment from an unterminated {/* inside inline code', () => {
    const input = ['Glob `src/{/*.ts` weird', '', 'more content', '', '# U', 'stuff'].join('\n');
    expect(stripMdx(input)).toBe(input);
  });

  it('still strips a real comment that follows inline code on the same line', () => {
    expect(stripMdx('a `x` {/* gone */} b')).toBe('a `x`  b');
  });
});

describe('stripMdx performance', () => {
  it('handles a long line of unterminated comment openers in linear time', () => {
    const started = performance.now();
    const out = stripMdx('{/* '.repeat(100000));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out.includes('\n')).toBe(false);
  });
});
