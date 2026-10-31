import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-params-'));
});
afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

function calls(fileName: string, source: string): string[] {
  const file = path.join(dir, fileName);
  writeFileSync(file, source);
  return parser
    .parseFileWithRelations(file)
    .relations.relations.filter((r) => r.type === 'calls')
    .map((r) => r.targetName)
    .sort();
}

describe('calling a parameter is not a relation to a symbol', () => {
  it('TypeScript: plain, optional, destructured-free and arrow parameters; closures see the parameters around them', () => {
    expect(calls('a.ts', [
      'function run(callback: () => void, done?: (e: Error) => void, ...rest: Array<() => void>) {',
      '  callback(); done?.(new Error("x")); other(); items.forEach((item) => { callback(); inner(item); });',
      '}',
      'const arrow = (cb) => cb(1) + helper(2);',
      'const single = handler => handler() + helper(3);',
      'class K { constructor(private readonly factory: () => void) { factory(); make(); } method(next: () => void) { next(); this.next(); } }',
    ].join('\n'))).toEqual(['Error', 'forEach', 'helper', 'helper', 'inner', 'make', 'next', 'other']);
  });

  it('JavaScript: a parameter of the same name in another function does not hide the call', () => {
    expect(calls('b.js', 'function a(callback) { callback(); }\nfunction b() { callback(); }')).toEqual(['callback']);
  });

  it('Python: plain, typed and default parameters, but not attribute calls', () => {
    expect(calls('a.py', [
      'def run(callback, handler: object, retry=None, *args, **kwargs):',
      '    callback()',
      '    handler()',
      '    retry()',
      '    self.callback()',
      '    other()',
    ].join('\n'))).toEqual(['callback', 'other']);
  });

  it('Rust, Go, Java and C#', () => {
    expect(calls('a.rs', 'fn run<F: Fn()>(op: F, mut sink: impl FnMut()) { op(); sink(); other(); }')).toEqual(['other']);
    expect(calls('a.go', 'package p\nfunc run(handler func(), a, b func()) { handler(); a(); other() }')).toEqual(['other']);
    expect(calls('A.java', 'class A { void m(Runnable r) { r.run(); other(); } }')).toEqual(['other', 'run']);
    expect(calls('A.cs', 'class A { void M(System.Action cb, System.Func<int> f) { cb(); f(); Other(); } }')).toEqual(['Other']);
  });
});
