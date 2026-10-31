import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';
import { getLanguageByExtension } from '../../../src/indexer/languages.ts';

const TSX_SOURCE = [
  "import React from 'react';",
  'interface Props { label: string }',
  'export function Button({ label }: Props) {',
  '  return <button className="b">{label}</button>;',
  '}',
  'export const List = ({ items }: { items: string[] }) => {',
  '  return (',
  '    <ul>',
  '      {items.map((i) => <li key={i}>{i}</li>)}',
  '    </ul>',
  '  );',
  '};',
  'export class Panel extends React.Component<Props> {',
  '  render() {',
  '    return <div><Button label={this.props.label} /></div>;',
  '  }',
  '}',
  'const Footer = () => <footer>done</footer>;',
].join('\n');

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-tsx-'));
});

afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('.tsx files use the tsx grammar', () => {
  it('maps .tsx to its own language and keeps .ts on the TypeScript grammar', () => {
    expect(getLanguageByExtension('.tsx')?.name).toBe('tsx');
    expect(getLanguageByExtension('.ts')?.name).toBe('typescript');
  });

  it('finds function, arrow-function and class components and their methods in JSX code', () => {
    const file = path.join(dir, 'App.tsx');
    writeFileSync(file, TSX_SOURCE);
    const chunks = parser.parseFile(file);
    const byName = new Map(chunks.map((c) => [c.symbolName, c]));
    expect([...byName.keys()].sort()).toEqual(['Button', 'Footer', 'List', 'Panel', 'Props', 'render']);
    expect(byName.get('List')?.signature).toBe('const List = ({ items }: { items: string[] }) =>');
    expect(byName.get('Panel')?.symbolType).toBe('class');
    expect(byName.get('render')?.parentSymbol).toBe('Panel');
    expect(byName.get('Button')?.language).toBe('tsx');
  });
});
