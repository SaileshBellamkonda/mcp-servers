import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.js';
import type { CodeChunk } from '../../../src/core/types.js';

let parser: CodeParser;
let dir: string;
let counter = 0;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-parent-'));
});

afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

function parse(ext: string, source: string): CodeChunk[] {
  const file = path.join(dir, `sample${String(counter++)}${ext}`);
  writeFileSync(file, source);
  return parser.parseFile(file);
}

/** `parent.name` of every function-like chunk, `name` when it has no parent. */
function owners(chunks: CodeChunk[]): string[] {
  return chunks.filter((c) => c.symbolType === 'method' || c.symbolType === 'function').map((c) => (c.parentSymbol === '' ? c.symbolName : `${c.parentSymbol}.${c.symbolName}`));
}

describe('parent symbol of Go methods', () => {
  it('is the receiver type, with or without a pointer or type parameters', () => {
    const chunks = parse('.go', [
      'package p',
      'type Server struct{}',
      'func (s *Server) Start() {}',
      'func (s Server) Stop() {}',
      'func (_ *Server) Reset() {}',
      'func (g *Group[T]) Add() {}',
      'func helper() {}',
    ].join('\n'));
    expect(owners(chunks)).toEqual(['Server.Start', 'Server.Stop', 'Server.Reset', 'Group.Add', 'helper']);
  });
});

describe('parent symbol of Rust functions', () => {
  it('is the implementing type, not the trait, in `impl Trait for Type`', () => {
    const chunks = parse('.rs', ['struct Foo;', 'impl Default for Foo { fn default() -> Self { Foo } }', 'impl Foo { fn make() -> Foo { Foo } }'].join('\n'));
    expect(owners(chunks)).toEqual(['Foo.default', 'Foo.make']);
  });

  it('is the type of a generic impl and of an impl for a path type', () => {
    const chunks = parse('.rs', [
      'struct Wrapper<T>(T);',
      "impl<'a, T: Clone> Wrapper<T> { fn get(&self) -> &T { &self.0 } }",
      'impl<T> std::fmt::Display for Wrapper<T> { fn fmt(&self) {} }',
      'impl Marker for std::vec::Vec<u8> { fn mark(&self) {} }',
    ].join('\n'));
    expect(owners(chunks)).toEqual(['Wrapper.get', 'Wrapper.fmt', 'Vec.mark']);
  });

  it('is the trait for the default methods of a trait', () => {
    const chunks = parse('.rs', 'trait Greet { fn name(&self) -> String; fn hello(&self) -> String { self.name() } }');
    expect(owners(chunks)).toContain('Greet.hello');
  });

  it('is empty for free functions and functions of an inline module', () => {
    const chunks = parse('.rs', 'fn top() {}\nmod inner { fn nested() {} }');
    expect(owners(chunks)).toEqual(['top', 'nested']);
  });
});

describe('parent symbol of Java methods', () => {
  it('is the enum, interface, record or annotation that declares the method', () => {
    const chunks = parse('.java', [
      'enum Color { RED, GREEN; String label() { return name(); } }',
      'interface Shape { double area(); default String title() { return "s"; } }',
      'record Point(int x, int y) { int sum() { return x + y; } }',
      'class Plain { void run() {} }',
    ].join('\n'));
    expect(owners(chunks)).toEqual(['Color.label', 'Shape.area', 'Shape.title', 'Point.sum', 'Plain.run']);
  });
});

describe('parent symbol of C# methods', () => {
  it('is the struct, record or interface that declares the method', () => {
    const chunks = parse('.cs', [
      'namespace N {',
      '  struct P { int Sum() { return 1; } }',
      '  record R(int A) { int Twice() { return 2; } }',
      '  interface I { void Go(); }',
      '  class C { void Run() {} }',
      '}',
    ].join('\n'));
    expect(owners(chunks)).toEqual(['P.Sum', 'R.Twice', 'I.Go', 'C.Run']);
  });

  it('is the type name even when a preprocessor condition sits in the declaration header', () => {
    const chunks = parse('.cs', [
      'namespace N {',
      '  public abstract partial class Writer',
      '#if HAVE_ASYNC',
      '    : IAsyncDisposable',
      '#endif',
      '  {',
      '    public void Close() {}',
      '  }',
      '}',
    ].join('\n'));
    expect(owners(chunks).filter((o) => o.endsWith('Close'))).toEqual(['Writer.Close']);
    expect(chunks.filter((c) => c.symbolType === 'class').map((c) => c.symbolName)).toEqual(['Writer']);
  });
});

describe('parent symbol of TypeScript methods', () => {
  it('is the abstract class that declares the method', () => {
    const chunks = parse('.ts', 'abstract class Base { run(): void {} abstract stop(): void; }\nclass Impl extends Base { stop(): void {} }');
    expect(owners(chunks)).toEqual(['Base.run', 'Impl.stop']);
  });
});
