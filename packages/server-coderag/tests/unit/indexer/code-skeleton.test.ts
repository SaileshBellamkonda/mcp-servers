import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_PARSER_VERSION, CodeParser } from '../../../src/indexer/code-parser.ts';
import type { CodeChunk } from '../../../src/core/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKELETON_MAX_CHARS = 2000;

let parser: CodeParser;
let dir: string;
let counter = 0;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-skeleton-'));
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

function find(chunks: CodeChunk[], name: string, type?: string): CodeChunk {
  const chunk = chunks.find((c) => c.symbolName === name && (type === undefined || c.symbolType === type));
  if (!chunk) throw new Error(`no chunk ${name}`);
  return chunk;
}

/** Lines of a skeleton after the header line(s), without surrounding whitespace. */
function memberLines(chunk: CodeChunk): string[] {
  return chunk.content.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

describe('container skeletons: TypeScript', () => {
  const source = [
    '/** Stores users. Second sentence. */',
    'export class Svc<T> extends Base implements Iface {',
    '  private readonly db: Db = new Db();',
    '  static count = 0;',
    '  constructor(a: string) { BODY_CTOR(); }',
    '  async find(id: string, opts?: Opts): Promise<Item | undefined> {',
    '    BODY_FIND();',
    '    return undefined;',
    '  }',
    '  abstract gone(): void;',
    '  get size(): number { BODY_GET(); return 1; }',
    '}',
    'export interface Shape<T> extends Base {',
    '  readonly id: string;',
    '  area(scale: number): number;',
    '}',
  ].join('\n');

  it('stores the header, the doc comment above and one line per member instead of the body', () => {
    const chunks = parse('.ts', source);
    const svc = find(chunks, 'Svc');
    expect(svc.content).toContain('class Svc<T> extends Base implements Iface');
    expect(svc.content).toContain('Stores users.');
    expect(svc.content).not.toContain('BODY_');
    expect(svc.content).not.toContain('return undefined');
    const lines = memberLines(svc);
    expect(lines).toContain('private readonly db: Db = new Db()');
    expect(lines).toContain('static count = 0');
    expect(lines).toContain('method constructor(a: string)');
    expect(lines).toContain('method async find(id: string, opts?: Opts): Promise<Item | undefined>');
    expect(lines).toContain('abstract gone(): void');
    expect(lines).toContain('method get size(): number');
  });

  it('keeps the line range, signature and symbol type of the whole class', () => {
    const svc = find(parse('.ts', source), 'Svc');
    expect(svc.symbolType).toBe('class');
    expect(svc.startLine).toBe(2);
    expect(svc.endLine).toBe(12);
    expect(svc.signature).toBe('class Svc<T> extends Base implements Iface');
  });

  it('members keep their own full chunks with the body', () => {
    const chunks = parse('.ts', source);
    const find1 = find(chunks, 'find', 'method');
    expect(find1.content).toContain('BODY_FIND();');
    expect(find1.parentSymbol).toBe('Svc');
    expect(find(chunks, 'constructor', 'method').content).toContain('BODY_CTOR();');
  });

  it('an interface lists its property and method signatures', () => {
    const shape = find(parse('.ts', source), 'Shape');
    const lines = memberLines(shape);
    expect(lines).toContain('readonly id: string');
    expect(lines).toContain('area(scale: number): number');
  });

  it('a class with 100 methods is capped at 60 member lines plus a "+N more" line and stays small', () => {
    const methods = Array.from({ length: 100 }, (_, i) => `  m${String(i)}(a: number): number { return a + ${String(i)}; }`);
    const big = find(parse('.ts', `class Big {\n${methods.join('\n')}\n}\n`), 'Big');
    const lines = memberLines(big);
    expect(lines.filter((l) => l.startsWith('method m')).length).toBeLessThanOrEqual(60);
    expect(lines.at(-1)).toMatch(/^\+\d+ more members$/);
    const shown = lines.filter((l) => l.startsWith('method m')).length;
    expect(lines.at(-1)).toBe(`+${String(100 - shown)} more members`);
    expect(big.content.length).toBeLessThanOrEqual(SKELETON_MAX_CHARS);
  });

  it('long member lines are clipped so the character budget holds', () => {
    const methods = Array.from({ length: 60 }, (_, i) => {
      const params = Array.from({ length: 12 }, (_, p) => `parameterNumber${String(p)}: string`).join(', ');
      return `  longMethod${String(i)}(${params}): void {}`;
    });
    const big = find(parse('.ts', `class Wide {\n${methods.join('\n')}\n}\n`), 'Wide');
    expect(big.content.length).toBeLessThanOrEqual(SKELETON_MAX_CHARS);
    expect(big.content).toMatch(/\+\d+ more members/);
  });

  it('a class without members keeps its (tiny) content', () => {
    const empty = find(parse('.ts', 'class Empty {}\n'), 'Empty');
    expect(empty.content).toBe('class Empty {}');
  });

  it('the 22k-character VectorDB class of this repository becomes a skeleton of at most 2000 characters', () => {
    const dbFile = path.join(here, '../../../src/vectordb/db.ts');
    const whole = readFileSync(dbFile, 'utf8');
    const chunks = parser.parseFile(dbFile);
    const vectorDb = find(chunks, 'VectorDB', 'class');
    expect(whole.length).toBeGreaterThan(20_000);
    expect(vectorDb.endLine - vectorDb.startLine).toBeGreaterThan(300);
    expect(vectorDb.content.length).toBeLessThanOrEqual(SKELETON_MAX_CHARS);
    expect(vectorDb.content).toContain('class VectorDB');
    expect(vectorDb.content).toContain('method static open(dbPath: string');
    expect(vectorDb.content).toContain('searchWithFilter');
    expect(vectorDb.content).toMatch(/\+\d+ more members/);
    // its methods are still indexed with their bodies
    const hybrid = find(chunks, 'searchHybrid', 'method');
    expect(hybrid.parentSymbol).toBe('VectorDB');
    expect(hybrid.content.length).toBeGreaterThan(300);
  });
});

describe('container skeletons: JavaScript and TSX', () => {
  it('JavaScript classes list their methods and fields without bodies', () => {
    const chunks = parse('.js', 'class Box {\n  size = 3;\n  static create(a, b) { BODY_X(); return new Box(a, b); }\n}\n');
    const box = find(chunks, 'Box');
    expect(box.content).not.toContain('BODY_X');
    expect(memberLines(box)).toContain('method static create(a, b)');
    expect(memberLines(box)).toContain('size = 3');
  });

  it('TSX classes are skeletons too', () => {
    const chunks = parse('.tsx', 'export class Panel extends C {\n  render() {\n    return <div>BODY_R</div>;\n  }\n}\n');
    const panel = find(chunks, 'Panel');
    expect(panel.content).not.toContain('BODY_R');
    expect(memberLines(panel)).toContain('method render()');
  });
});

describe('container skeletons: Python', () => {
  it('keeps the docstring first line, unwraps decorated methods and lists class attributes and nested classes', () => {
    const chunks = parse('.py', [
      'class Repo(Base):',
      '    """Stores things.',
      '',
      '    Longer text.',
      '    """',
      '    limit = 10',
      '',
      '    @staticmethod',
      '    def make(url: str) -> "Repo":',
      '        BODY_MAKE()',
      '        return Repo()',
      '',
      '    def get(self, key: str) -> str:',
      '        BODY_GET()',
      '',
      '    class Inner:',
      '        BODY_INNER = 1',
    ].join('\n'));
    const repo = find(chunks, 'Repo');
    expect(repo.content).toContain('class Repo(Base):');
    expect(repo.content).toContain('Stores things.');
    expect(repo.content).not.toContain('Longer text');
    expect(repo.content).not.toContain('BODY_MAKE');
    expect(repo.content).not.toContain('BODY_GET');
    const lines = memberLines(repo);
    expect(lines).toContain('limit = 10');
    expect(lines).toContain('def make(url: str) -> "Repo":');
    expect(lines).toContain('def get(self, key: str) -> str:');
    expect(lines).toContain('class Inner:');
    expect(find(chunks, 'get').content).toContain('BODY_GET()');
  });
});

describe('container skeletons: Go', () => {
  const source = [
    'package main',
    '',
    '// Dog is a pet.',
    'type Dog struct {',
    '\tName string',
    '\tAge  int // years',
    '}',
    '',
    'type Speaker interface {',
    '\tSound() string',
    '\tName() string',
    '}',
    '',
    'func (d *Dog) Sound() string {',
    '\treturn "BODY_SOUND"',
    '}',
  ].join('\n');

  it('a struct lists its fields and an interface its methods', () => {
    const chunks = parse('.go', source);
    const dog = find(chunks, 'Dog', 'struct');
    expect(dog.content).toContain('type Dog struct');
    expect(dog.content).toContain('Dog is a pet.');
    expect(memberLines(dog)).toContain('Name string');
    expect(memberLines(dog)).toContain('Age int');
    const speaker = find(chunks, 'Speaker', 'interface');
    expect(memberLines(speaker)).toContain('Sound() string');
    expect(memberLines(speaker)).toContain('Name() string');
  });

  it('methods declared outside the struct stay separate chunks with their bodies', () => {
    const sound = find(parse('.go', source), 'Sound', 'method');
    expect(sound.content).toContain('BODY_SOUND');
  });

  it('a large struct is bounded', () => {
    const fields = Array.from({ length: 200 }, (_, i) => `\tField${String(i)} string`);
    const big = find(parse('.go', `package m\ntype Big struct {\n${fields.join('\n')}\n}\n`), 'Big');
    expect(big.content.length).toBeLessThanOrEqual(SKELETON_MAX_CHARS);
    expect(big.content).toMatch(/\+\d+ more members/);
  });
});

describe('container skeletons: Rust', () => {
  const source = [
    '/// A point.',
    '#[derive(Debug)]',
    'pub struct Point { pub x: i32, y: i32 }',
    'pub enum Shape { Circle(f64), Square }',
    'impl Point {',
    '    const ORIGIN: i32 = 0;',
    '    #[inline]',
    '    pub fn dist(&self, other: &Point) -> i32 { BODY_DIST(); 1 }',
    '}',
    'pub trait Area {',
    '    fn area(&self) -> f64;',
    '    fn double(&self) -> f64 { BODY_DOUBLE(); 2.0 }',
    '}',
  ].join('\n');

  it('impl blocks list their functions and constants, structs their fields, enums their variants', () => {
    const chunks = parse('.rs', source);
    const impl = chunks.find((c) => c.symbolName === 'Point' && c.content.startsWith('impl'));
    expect(impl).toBeDefined();
    expect(impl?.content).not.toContain('BODY_DIST');
    expect(memberLines(impl as CodeChunk)).toContain('pub fn dist(&self, other: &Point) -> i32');
    expect(memberLines(impl as CodeChunk)).toContain('const ORIGIN: i32 = 0');
    const struct = chunks.find((c) => c.symbolName === 'Point' && !c.content.startsWith('impl'));
    expect(struct?.content).toContain('pub struct Point');
    expect(struct?.content).toContain('A point.');
    expect(memberLines(struct as CodeChunk)).toContain('pub x: i32');
    const shape = find(chunks, 'Shape');
    expect(memberLines(shape)).toContain('Circle(f64)');
    expect(memberLines(shape)).toContain('Square');
  });

  it('traits list required and provided functions; function chunks keep their bodies', () => {
    const chunks = parse('.rs', source);
    const area = find(chunks, 'Area', 'interface');
    expect(area.content).not.toContain('BODY_DOUBLE');
    expect(memberLines(area)).toContain('fn area(&self) -> f64');
    expect(memberLines(area)).toContain('fn double(&self) -> f64');
    expect(find(chunks, 'dist').content).toContain('BODY_DIST()');
  });
});

describe('container skeletons: Java', () => {
  it('lists fields, constructors, methods and nested classes without bodies', () => {
    const chunks = parse('.java', [
      '/** Animal base. */',
      'public class Animal<T> extends Base {',
      '    private final String name;',
      '    public Animal(String name) { BODY_CTOR(); }',
      '    @Override',
      '    public String getName() { BODY_GET(); return name; }',
      '    static class Nested { int q; }',
      '}',
      'interface Walker { void walk(int steps); }',
    ].join('\n'));
    const animal = find(chunks, 'Animal', 'class');
    expect(animal.content).toContain('public class Animal<T> extends Base');
    expect(animal.content).toContain('Animal base.');
    expect(animal.content).not.toContain('BODY_');
    const lines = memberLines(animal);
    expect(lines).toContain('private final String name');
    expect(lines).toContain('function public Animal(String name)');
    expect(lines).toContain('method @Override public String getName()');
    expect(lines).toContain('static class Nested');
    expect(memberLines(find(chunks, 'Walker'))).toContain('method void walk(int steps);');
    expect(find(chunks, 'getName').content).toContain('BODY_GET()');
  });
});

describe('container skeletons: C#', () => {
  it('lists properties, fields, constructors and methods without bodies', () => {
    const chunks = parse('.cs', [
      'public class Repo<T> : Base {',
      '    private int count;',
      '    public string Name { get; set; }',
      '    public Repo() { BODY_CTOR(); }',
      '    public void Run(int n) { BODY_RUN(); }',
      '}',
    ].join('\n'));
    const repo = find(chunks, 'Repo', 'class');
    expect(repo.content).toContain('public class Repo<T> : Base');
    expect(repo.content).not.toContain('BODY_');
    const lines = memberLines(repo);
    expect(lines).toContain('private int count');
    expect(lines).toContain('public string Name { get; set; }');
    expect(lines).toContain('function public Repo()');
    expect(lines).toContain('method public void Run(int n)');
    expect(find(chunks, 'Run').content).toContain('BODY_RUN()');
  });
});

describe('container skeletons: C++', () => {
  it('classes and structs list declarations and inline methods without bodies; access specifiers are not members', () => {
    const chunks = parse('.cpp', [
      'class Foo : public Bar {',
      ' public:',
      '  int x;',
      '  void run();',
      '  int inl() { return BODY_INL; }',
      '};',
      'struct Pt { int a; int b; };',
    ].join('\n'));
    const foo = find(chunks, 'Foo', 'class');
    expect(foo.content).toContain('class Foo : public Bar');
    expect(foo.content).not.toContain('BODY_INL');
    const lines = memberLines(foo);
    expect(lines).toContain('int x');
    expect(lines).toContain('void run()');
    expect(lines).toContain('int inl()');
    expect(lines.some((l) => l.startsWith('public'))).toBe(false);
    expect(memberLines(find(chunks, 'Pt', 'struct'))).toContain('int a');
  });
});

describe('container skeletons: other languages keep the whole class', () => {
  it('Ruby classes are unchanged', () => {
    const chunks = parse('.rb', 'class Greeter\n  def hi\n    BODY_HI\n  end\nend\n');
    expect(find(chunks, 'Greeter').content).toContain('BODY_HI');
  });

  it('PHP classes are unchanged', () => {
    const chunks = parse('.php', '<?php\nclass G {\n  public function hi() { BODY_HI(); }\n}\n');
    expect(find(chunks, 'G').content).toContain('BODY_HI');
  });
});

describe('parser version', () => {
  it('was bumped so existing indexes are re-parsed once', () => {
    expect(CODE_PARSER_VERSION).toBeGreaterThanOrEqual(4);
  });
});
