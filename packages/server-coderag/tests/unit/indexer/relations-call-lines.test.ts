import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-lines-'));
});
afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

/** `callee@line` of every recorded call, in the order they were found. */
function callLines(fileName: string, source: string): string[] {
  const file = path.join(dir, fileName);
  writeFileSync(file, source);
  return parser
    .parseFileWithRelations(file)
    .relations.relations.filter((r) => r.type === 'calls')
    .map((r) => `${r.targetName}@${String(r.line)}`)
    .sort();
}

describe('the line of a call is the line of the called name, not where its chain starts', () => {
  it('TypeScript fluent chains', () => {
    expect(callLines('a.ts', ['function build() {', '  return Builder.create()', '    .withA(1)', '    .withB(2);', '}'].join('\n'))).toEqual(['create@2', 'withA@3', 'withB@4']);
  });

  it('Java fluent chains and constructors', () => {
    const source = ['class A {', '  void m() {', '    Foo.builder()', '        .add(1)', '        .build(new Widget(', '            2));', '  }', '}'].join('\n');
    expect(callLines('A.java', source)).toEqual(['Widget@5', 'add@4', 'build@5', 'builder@3']);
  });

  it('Rust builder chains', () => {
    expect(callLines('a.rs', ['fn run() {', '    let b = Builder::new()', '        .stats(true)', '        .build();', '}'].join('\n'))).toEqual(['build@4', 'new@2', 'stats@3']);
  });

  it('Python chained calls', () => {
    expect(callLines('a.py', ['def run():', '    return (client.get("/")', '        .json()', '        .keys())'].join('\n'))).toEqual(['get@2', 'json@3', 'keys@4']);
  });

  it('C# chained calls', () => {
    const source = ['class A {', '  void M() {', '    Items', '      .Where(x => x)', '      .Select(x => x);', '  }', '}'].join('\n');
    expect(callLines('A.cs', source)).toEqual(['Select@5', 'Where@4']);
  });

  it('Go chained calls', () => {
    expect(callLines('a.go', ['package p', 'func run() {', '\tb := New().', '\t\tWith(1).', '\t\tBuild()', '}'].join('\n'))).toEqual(['Build@5', 'New@3', 'With@4']);
  });

  it('keeps the line of a plain single-line call', () => {
    expect(callLines('b.ts', 'function f() {\n  helper(1);\n}')).toEqual(['helper@2']);
  });
});
