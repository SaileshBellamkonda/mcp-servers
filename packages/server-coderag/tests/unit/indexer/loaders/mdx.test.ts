import { describe, it, expect } from 'vitest';
import { MdxLoader, stripMdx } from '../../../../src/indexer/loaders/mdx.ts';

const loader = new MdxLoader();

const SOURCE = [
  '---',
  'title: Hello MDX',
  'tags: [mdx]',
  '---',
  "import { Tabs } from '@site/components'",
  "import Foo from './foo'",
  '',
  '# Intro',
  '',
  'export const meta = {',
  '  a: 1',
  '}',
  '',
  'Some text with <Badge text="new" /> inline.',
  '',
  '<Tabs defaultValue="a">',
  '<Tab value="a">Alpha content</Tab>',
  '</Tabs>',
  '',
  '{/* a comment */}',
  '',
  '```js',
  "import x from 'y'",
  '<Keep />',
  '```',
].join('\n');

describe('MdxLoader', () => {
  it('declares the .mdx extension', () => {
    expect(loader.name).toBe('mdx');
    expect([...loader.extensions]).toEqual(['.mdx']);
  });

  it('strips ESM, comments and component tags while keeping prose and code fences', () => {
    const doc = loader.load('/x/page.mdx', SOURCE);

    expect(doc.metadata.title).toBe('Hello MDX');
    expect(doc.metadata.tags).toEqual(['mdx']);
    expect(doc.sections).toHaveLength(1);

    const section = doc.sections[0];
    expect(section?.headingPath).toEqual(['Intro']);
    expect(section?.startLine).toBe(8);
    expect(section?.endLine).toBe(25);

    const text = section?.text ?? '';
    expect(text).toContain('Some text with');
    expect(text).toContain('Alpha content');
    expect(text).not.toContain("import { Tabs }");
    expect(text).not.toContain('export const meta');
    expect(text).not.toContain('<Badge');
    expect(text).not.toContain('<Tabs');
    expect(text).not.toContain('</Tab>');
    expect(text).not.toContain('a comment');
    // fenced code is never rewritten
    expect(text).toContain("import x from 'y'");
    expect(text).toContain('<Keep />');
  });
});

describe('stripMdx', () => {
  it('keeps the line count unchanged', () => {
    const body = SOURCE.split('\n').slice(4).join('\n');
    expect(stripMdx(body).split('\n')).toHaveLength(body.split('\n').length);
  });

  it('blanks a multi-line ESM block up to the next blank line', () => {
    const out = stripMdx(['export const meta = {', '  a: 1', '}', '', 'prose'].join('\n'));
    expect(out.split('\n')).toEqual(['', '', '', '', 'prose']);
  });

  it('does not mistake prose that starts with "import" or "export" for ESM', () => {
    const out = stripMdx('import the data into the sheet\nexport results monthly');
    expect(out).toBe('import the data into the sheet\nexport results monthly');
  });

  it('removes multi-line {/* */} comments', () => {
    const out = stripMdx(['{/* start', 'middle', 'end */}', 'visible'].join('\n'));
    expect(out).not.toContain('middle');
    expect(out).toContain('visible');
    expect(out.split('\n')).toHaveLength(4);
  });

  it('keeps the text inside dotted component tags', () => {
    expect(stripMdx('<Tab.Item label="x">text</Tab.Item>')).toBe('text');
  });

  it('leaves generics in prose and lower-case html alone', () => {
    expect(stripMdx('Use Array<Foo> here')).toBe('Use Array<Foo> here');
    expect(stripMdx('<div>hi</div>')).toBe('<div>hi</div>');
  });
});
