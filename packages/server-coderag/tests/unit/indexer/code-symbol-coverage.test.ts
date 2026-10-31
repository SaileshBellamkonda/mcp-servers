import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';
import type { CodeChunk } from '../../../src/core/types.ts';

let parser: CodeParser;
let dir: string;
let counter = 0;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-coverage-'));
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

/** `type name` of the chunks that are not methods or functions. */
function declared(chunks: CodeChunk[]): string[] {
  return chunks.filter((c) => c.symbolType !== 'method' && c.symbolType !== 'function').map((c) => `${c.symbolType} ${c.symbolName}`);
}

function find(chunks: CodeChunk[], name: string): CodeChunk {
  const chunk = chunks.find((c) => c.symbolName === name && c.symbolType !== 'function' && c.symbolType !== 'method');
  if (!chunk) throw new Error(`no chunk ${name}`);
  return chunk;
}

describe('Java types that were not indexed', () => {
  const source = [
    'enum Color implements Named { RED("r"), GREEN("g") { int x() { return 1; } }; private final String s; Color(String s) { this.s = s; } String label() { return s; } }',
    'record Point(int x, int y) implements Shape { Point { } int sum() { return x + y; } }',
    '@interface Ann { String value() default ""; }',
    'class Plain {}',
  ].join('\n');

  it('indexes enums and records as classes and annotation types as interfaces', () => {
    expect(declared(parse('.java', source))).toEqual(['class Color', 'class Point', 'interface Ann', 'class Plain']);
  });

  it('lists the constants and members of an enum in its skeleton', () => {
    const color = find(parse('.java', source), 'Color');
    const lines = color.content.split('\n').map((l) => l.trim());
    expect(lines.some((l) => l.includes('RED'))).toBe(true);
    expect(lines.some((l) => l.includes('GREEN'))).toBe(true);
    expect(lines.some((l) => l.includes('label()'))).toBe(true);
    expect(color.content).not.toContain('return s;');
  });

  it('records the interfaces an enum or record implements', () => {
    const file = path.join(dir, `sample${String(counter++)}.java`);
    writeFileSync(file, source);
    const targets = parser.parseFileWithRelations(file).relations.relations.filter((r) => r.type === 'inherits').map((r) => r.targetName);
    expect(targets).toEqual(expect.arrayContaining(['Named', 'Shape']));
  });
});

describe('C# types that were not indexed', () => {
  const source = [
    'namespace N {',
    '  enum E : byte { A, B = 2 }',
    '  struct S : IFoo { int x; int Get() { return x; } }',
    '  record R(int A) : Base { int Twice() { return A * 2; } }',
    '  record struct RS(int A);',
    '  class C {}',
    '}',
  ].join('\n');

  it('indexes enums and records as classes and structs as structs', () => {
    const chunks = parse('.cs', source);
    expect(declared(chunks)).toEqual(['class E', 'struct S', 'class R', 'class RS', 'class C']);
  });

  it('lists the members of an enum in its skeleton', () => {
    const e = find(parse('.cs', source), 'E');
    expect(e.content).toContain('A');
    expect(e.content).toContain('B = 2');
  });

  it('records the base types of a struct and a record', () => {
    const file = path.join(dir, `sample${String(counter++)}.cs`);
    writeFileSync(file, source);
    const targets = parser.parseFileWithRelations(file).relations.relations.filter((r) => r.type === 'inherits').map((r) => r.targetName);
    expect(targets).toEqual(expect.arrayContaining(['IFoo', 'Base']));
  });
});

describe('TypeScript types that were not indexed', () => {
  it('indexes abstract classes and enums as classes', () => {
    const chunks = parse('.ts', 'export abstract class Base { abstract run(): void; }\nexport enum Level { Low, High = 2 }\nclass Impl extends Base {}');
    expect(declared(chunks)).toEqual(['class Base', 'class Level', 'class Impl']);
    expect(find(chunks, 'Level').content).toContain('High = 2');
  });

  it('records the base class of an abstract class', () => {
    const file = path.join(dir, `sample${String(counter++)}.ts`);
    writeFileSync(file, 'abstract class A extends Root implements Named {}');
    const targets = parser.parseFileWithRelations(file).relations.relations.filter((r) => r.type === 'inherits').map((r) => r.targetName);
    expect(targets).toEqual(['Root', 'Named']);
  });
});

describe('Rust impl blocks of generic types', () => {
  it('are indexed like other impl blocks, named after the type', () => {
    const chunks = parse('.rs', [
      'struct Wrapper<T>(T);',
      "impl<'a, T: Clone> Wrapper<T> { fn get(&self) -> &T { &self.0 } }",
      'impl<T> Default for Wrapper<T> { fn default() -> Self { todo!() } }',
    ].join('\n'));
    expect(declared(chunks)).toEqual(['struct Wrapper', 'struct Wrapper', 'struct Wrapper']);
    expect(chunks.filter((c) => c.symbolType === 'struct' && c.content.includes('fn get')).length).toBeGreaterThan(0);
  });

  it('records the trait a generic impl implements', () => {
    const file = path.join(dir, `sample${String(counter++)}.rs`);
    writeFileSync(file, 'struct W<T>(T);\nimpl<T> Default for W<T> { fn default() -> Self { todo!() } }');
    const rels = parser.parseFileWithRelations(file).relations.relations.filter((r) => r.type === 'inherits');
    expect(rels.map((r) => r.targetName)).toEqual(['Default']);
  });
});
