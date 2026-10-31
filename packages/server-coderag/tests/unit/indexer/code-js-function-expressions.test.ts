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
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-jsfn-'));
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

/** `parent.name` (or `name`) of every chunk. */
function names(chunks: CodeChunk[]): string[] {
  return chunks.map((c) => (c.parentSymbol === '' ? c.symbolName : `${c.parentSymbol}.${c.symbolName}`));
}

const COMMON_JS = [
  "'use strict';",
  'var app = exports = module.exports = {};',
  'app.use = function use(fn) { return fn; };',
  'app.handle = function (req, res) { return 1; };',
  'res.send = function send(body) { return body; };',
  'var helper = function (x) { return x; };',
  'var viaArrow = (y) => y;',
  'const arrow = (y) => y;',
  'function Foo() {}',
  'Foo.prototype.bar = function bar() { return 1; };',
  'Foo.prototype.baz = () => 2;',
  'module.exports = function createApplication() { return 1; };',
  'exports.exported = function () {};',
  'class K { static make() {} }',
  'const obj = { method() {}, prop: function () {}, arrowProp: () => 1 };',
  'var notAFunction = 42;',
  'config.timeout = 30;',
].join('\n');

describe('JavaScript functions that are not declarations', () => {
  it('indexes function expressions and arrows assigned to a variable or a property', () => {
    expect(names(parse('.js', COMMON_JS)).sort()).toEqual(
      ['Foo', 'Foo.bar', 'Foo.baz', 'K', 'K.make', 'use', 'handle', 'send', 'helper', 'viaArrow', 'arrow', 'createApplication', 'exported', 'method'].sort(),
    );
  });

  it('stores function expressions as functions with a signature up to the body', () => {
    const chunks = parse('.js', COMMON_JS);
    const use = chunks.find((c) => c.symbolName === 'use');
    expect(use).toMatchObject({ symbolType: 'function', startLine: 3, endLine: 3, signature: 'app.use = function use(fn)' });
    expect(use?.content).toBe('app.use = function use(fn) { return fn; }');
    expect(chunks.find((c) => c.symbolName === 'helper')?.signature).toBe('var helper = function (x)');
    expect(chunks.find((c) => c.symbolName === 'viaArrow')?.signature).toBe('var viaArrow = (y) =>');
  });

  it('records calls made inside them and attributes prototype methods to the constructor', () => {
    const file = path.join(dir, `sample${String(counter++)}.js`);
    writeFileSync(file, 'function Foo() {}\nFoo.prototype.run = function run() { helper(); };\nvar go = function () { other(); };');
    const { chunks, relations } = parser.parseFileWithRelations(file);
    const bySource = relations.relations.filter((r) => r.type === 'calls').map((r) => `${chunks[r.sourcePosition]?.symbolName ?? '?'}->${r.targetName}`);
    expect(bySource.sort()).toEqual(['go->other', 'run->helper']);
    expect(chunks.find((c) => c.symbolName === 'run')?.parentSymbol).toBe('Foo');
  });
});

describe('TypeScript variables holding function expressions', () => {
  it('indexes `var f = () => ...` and `const f = function () {}`', () => {
    const chunks = parse('.ts', 'var a = (x: number) => x;\nconst b = function (y: string) { return y; };\nvar c = function named() {};\nconst d = 5;');
    expect(names(chunks)).toEqual(['a', 'b', 'c']);
  });
});
