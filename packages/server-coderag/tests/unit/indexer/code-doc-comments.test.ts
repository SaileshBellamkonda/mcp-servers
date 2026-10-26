import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CODE_PARSER_VERSION, CodeParser } from '../../../src/indexer/code-parser.js';
import type { CodeChunk } from '../../../src/core/types.js';

let parser: CodeParser;
let dir: string;
let counter = 0;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-doc-'));
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

function find(chunks: CodeChunk[], name: string): CodeChunk {
  const chunk = chunks.find((c) => c.symbolName === name);
  if (!chunk) throw new Error(`no chunk ${name}`);
  return chunk;
}

describe('doc comments of functions and methods: TypeScript and JavaScript', () => {
  const source = [
    '/**',
    ' * Computes the checksum of a payload.',
    ' * Second line of the same paragraph.',
    ' *',
    ' * Later paragraph that must not be indexed.',
    ' * @param data the bytes',
    ' */',
    'export function checksum(data: Buffer): number { return 1; }',
    '',
    '// Adds two numbers',
    '// without overflow checks.',
    'const add = (a: number, b: number) => a + b;',
    '',
    '// detached comment',
    '',
    'function detached() {}',
    '',
    'class Svc {',
    '  /** Finds a user by {@link UserId}. */',
    '  find(id: string) { return id; }',
    '  other() {}',
    '}',
    '',
    '// eslint-disable-next-line no-console',
    'function noisy() {}',
  ].join('\n');
  let chunks: CodeChunk[] = [];
  beforeAll(() => {
    chunks = parse('.ts', source);
  });

  it('takes the first paragraph of a JSDoc block above an exported function, without comment markers', () => {
    expect(find(chunks, 'checksum').doc).toBe('Computes the checksum of a payload. Second line of the same paragraph.');
  });

  it('takes a run of // lines above an arrow function assigned to a constant', () => {
    expect(find(chunks, 'add').doc).toBe('Adds two numbers without overflow checks.');
  });

  it('takes the comment above a method inside a class and unwraps inline tags', () => {
    expect(find(chunks, 'find').doc).toBe('Finds a user by UserId.');
  });

  it('has no doc when there is none, when a blank line separates the comment, or when it is a lint directive', () => {
    expect(find(chunks, 'other').doc).toBeUndefined();
    expect(find(chunks, 'detached').doc).toBeUndefined();
    expect(find(chunks, 'noisy').doc).toBeUndefined();
  });

  it('keeps content, signature and symbol range free of the comment', () => {
    const checksum = find(chunks, 'checksum');
    expect(checksum.content).toBe('function checksum(data: Buffer): number { return 1; }');
    expect(checksum.signature).toBe('function checksum(data: Buffer): number');
    expect(checksum.startLine).toBe(8);
  });

  it('caps a long comment at about 300 characters', () => {
    const long = parse('.ts', `// ${'word '.repeat(200)}\nfunction f() {}\n`);
    const doc = find(long, 'f').doc ?? '';
    expect(doc.length).toBeGreaterThan(250);
    expect(doc.length).toBeLessThanOrEqual(300);
  });

  it('JavaScript property assignments and var functions take the comment above their statement', () => {
    const js = parse('.js', ['// Exported helper.', 'exports.helper = function () { return 1; };', '', '/** Old style. */', 'var legacy = function () {};'].join('\n'));
    expect(find(js, 'helper').doc).toBe('Exported helper.');
    expect(find(js, 'legacy').doc).toBe('Old style.');
  });

  it('a class keeps its doc line in the skeleton and gets no separate doc', () => {
    const cls = parse('.ts', '/** Stores users. */\nexport class Store {\n  put(a: string) { return a; }\n}\n');
    expect(find(cls, 'Store').content).toContain('Stores users.');
    expect(find(cls, 'Store').doc).toBeUndefined();
  });
});

describe('doc comments of functions and methods: other languages', () => {
  it('Python: a # run above a decorated function counts, a docstring does not (it is in the body already)', () => {
    const chunks = parse('.py', [
      '# Builds the app.',
      '# Called once.',
      '@cache',
      'def build():',
      '    """Docstring text."""',
      '    return 1',
      '',
      'def plain():',
      '    """Only a docstring."""',
      '    return 2',
      '',
      'class K:',
      '    # Method comment.',
      '    def m(self):',
      '        pass',
    ].join('\n'));
    expect(find(chunks, 'build').doc).toBe('Builds the app. Called once.');
    expect(find(chunks, 'plain').doc).toBeUndefined();
    expect(find(chunks, 'm').doc).toBe('Method comment.');
  });

  it('Go: a // run above a function or method', () => {
    const chunks = parse('.go', [
      'package p',
      '',
      '// Execute runs the command',
      '// and returns its error.',
      'func Execute() error { return nil }',
      '',
      '// Start begins serving.',
      'func (s *Server) Start() {}',
    ].join('\n'));
    expect(find(chunks, 'Execute').doc).toBe('Execute runs the command and returns its error.');
    expect(find(chunks, 'Start').doc).toBe('Start begins serving.');
  });

  it('Rust: /// lines above an attribute and the function', () => {
    const chunks = parse('.rs', [
      '/// Parses the flags.',
      '///',
      '/// Second paragraph.',
      '#[inline]',
      'pub fn parse() -> u8 { 1 }',
      '',
      'struct S;',
      'impl S {',
      '    /// Makes one.',
      '    fn make() -> S { S }',
      '}',
    ].join('\n'));
    expect(find(chunks, 'parse').doc).toBe('Parses the flags.');
    expect(find(chunks, 'make').doc).toBe('Makes one.');
  });

  it('Java: first paragraph of a Javadoc, without tags and @param lines', () => {
    const chunks = parse('.java', [
      'class A {',
      '  /**',
      '   * Parses the {@code text} into a <b>number</b>.',
      '   * <p>Details that do not belong to the first paragraph.',
      '   *',
      '   * @param text the input',
      '   * @return the number',
      '   */',
      '  public int parse(String text) { return 1; }',
      '',
      '  /** Creates it. */',
      '  @Deprecated',
      '  public A() {}',
      '}',
    ].join('\n'));
    expect(find(chunks, 'parse').doc).toBe('Parses the text into a number.');
    expect(find(chunks, 'A').symbolType).toBeDefined();
    const ctor = chunks.find((c) => c.symbolName === 'A' && c.symbolType === 'function');
    expect(ctor?.doc).toBe('Creates it.');
  });

  it('C#: the summary of /// XML comments with tags removed, not the param and returns parts', () => {
    const chunks = parse('.cs', [
      'class C {',
      '    /// <summary>',
      '    /// Reads the <see cref="Token"/> from the stream',
      '    /// and advances.',
      '    /// </summary>',
      '    /// <param name="stream">the stream</param>',
      '    /// <returns>the token</returns>',
      '    public Token Read(Stream stream) { return null; }',
      '',
      '    /// <summary>Writes it.</summary>',
      '    /// <param name="x">value</param>',
      '    public void Write(int x) {}',
      '}',
    ].join('\n'));
    expect(find(chunks, 'Read').doc).toBe('Reads the Token from the stream and advances.');
    expect(find(chunks, 'Write').doc).toBe('Writes it.');
  });

  it('C++, C, PHP, Ruby and Bash take the comment above', () => {
    expect(find(parse('.cpp', '// Adds.\nint add(int a, int b) { return a + b; }\n'), 'add').doc).toBe('Adds.');
    expect(find(parse('.c', '/* Subtracts. */\nint sub(int a) { return a; }\n'), 'sub').doc).toBe('Subtracts.');
    expect(find(parse('.php', '<?php\n/** Greets. */\nfunction greet() {}\n'), 'greet').doc).toBe('Greets.');
    expect(find(parse('.rb', 'class R\n  # Says hi.\n  def hi\n  end\nend\n'), 'hi').doc).toBe('Says hi.');
    expect(find(parse('.sh', '# Cleans up.\ncleanup() {\n  rm -rf x\n}\n'), 'cleanup').doc).toBe('Cleans up.');
  });

  it('a license header directly above the first function is not a doc comment', () => {
    const chunks = parse('.ts', '// Copyright 2024 Example Corp.\nfunction first() {}\n');
    expect(find(chunks, 'first').doc).toBeUndefined();
  });
});

describe('embedding text', () => {
  it('puts the doc comment between the symbol label and the code', () => {
    const chunk = find(parse('.ts', '/** Computes x. */\nfunction compute() { return 1; }\n'), 'compute');
    expect(CodeParser.getEmbeddingText(chunk)).toBe('typescript compute: Computes x.\nfunction compute() { return 1; }');
  });

  it('is unchanged for a chunk without a doc', () => {
    const chunk = find(parse('.ts', 'function bare() { return 1; }\n'), 'bare');
    expect(CodeParser.getEmbeddingText(chunk)).toBe('typescript bare: function bare() { return 1; }');
  });
});

describe('parser version', () => {
  it('was bumped so existing indexes are re-parsed and re-embedded once with their doc comments', () => {
    expect(CODE_PARSER_VERSION).toBeGreaterThanOrEqual(9);
  });
});
