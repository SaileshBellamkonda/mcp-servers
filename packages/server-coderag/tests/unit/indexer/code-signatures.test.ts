import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.js';

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-sig-'));
});

afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function signatures(ext: string, source: string): Record<string, string> {
  const file = path.join(dir, `sample${String(counter++)}${ext}`);
  writeFileSync(file, source);
  const result: Record<string, string> = {};
  for (const chunk of parser.parseFile(file)) result[chunk.symbolName] = chunk.signature;
  return result;
}

describe('signatures from the tree-sitter body field', () => {
  it('TypeScript: stops at the body, drops decorators, collapses multi-line parameters, ignores arrows inside bodies', () => {
    const sigs = signatures('.ts', [
      'export class Svc<T extends Base> extends Parent implements Iface {',
      "  @Get('/x')",
      '  async find(',
      '    id: string,',
      '    opts?: Opts,',
      '  ): Promise<Item | undefined> {',
      '    return this.items.map((i) => i.id).find((i) => i === id);',
      '  }',
      '}',
      'function plain(a: number): string { const f = (x: number) => x; return String(f(a)); }',
      'const handler = async (req: Req, res: Res): Promise<void> => {',
      '  items.forEach((i) => { run(i); });',
      '};',
      'const short = (a: number) => a + 1;',
      'interface Shape<T> extends Base { area(): number; }',
    ].join('\n'));
    expect(sigs['Svc']).toBe('class Svc<T extends Base> extends Parent implements Iface');
    expect(sigs['find']).toBe('async find(id: string, opts?: Opts): Promise<Item | undefined>');
    expect(sigs['plain']).toBe('function plain(a: number): string');
    expect(sigs['handler']).toBe('const handler = async (req: Req, res: Res): Promise<void> =>');
    expect(sigs['short']).toBe('const short = (a: number) =>');
    expect(sigs['Shape']).toBe('interface Shape<T> extends Base');
  });

  it('TypeScript: decorated classes start at the class keyword', () => {
    const sigs = signatures('.ts', "@Injectable({ providedIn: 'root' })\nexport class Dec { run(): void {} }\n");
    expect(sigs['Dec']).toBe('class Dec');
  });

  it('TypeScript: a signature longer than 200 characters is cut with an ellipsis', () => {
    const params = Array.from({ length: 40 }, (_, i) => `argument${String(i)}: string`).join(', ');
    const sig = signatures('.ts', `function wide(${params}): void {}\n`)['wide'] ?? '';
    expect(sig).toHaveLength(200);
    expect(sig.endsWith('…')).toBe(true);
    expect(sig.startsWith('function wide(argument0: string, ')).toBe(true);
  });

  it('JavaScript: arrow functions, methods and functions', () => {
    const sigs = signatures('.js', [
      'const mk = (a) => { return list.map((x) => x * 2); };',
      'class Box {',
      '  static create(a, b) { return new Box(a, b); }',
      '}',
      'function old(a) { return [1].map((v) => v + a); }',
    ].join('\n'));
    expect(sigs['mk']).toBe('const mk = (a) =>');
    expect(sigs['create']).toBe('static create(a, b)');
    expect(sigs['Box']).toBe('class Box');
    expect(sigs['old']).toBe('function old(a)');
  });

  it('Python: keeps annotated parameters, async and the return type; excludes decorators', () => {
    const sigs = signatures('.py', [
      '@decorator',
      'async def fetch(',
      '    url: str,',
      '    retries: int = 3,',
      ') -> dict[str, int]:',
      '    """Doc."""',
      '    return {}',
      '',
      'class Repo(Base, metaclass=Meta):',
      '    def get(self, key: str) -> str: return key',
    ].join('\n'));
    expect(sigs['fetch']).toBe('async def fetch(url: str, retries: int = 3) -> dict[str, int]:');
    expect(sigs['Repo']).toBe('class Repo(Base, metaclass=Meta):');
    expect(sigs['get']).toBe('def get(self, key: str) -> str:');
  });

  it('Go: functions with receivers and generics; a struct falls back to its first line', () => {
    const sigs = signatures('.go', [
      'package main',
      'func (d *Dog) Speak(loud bool) string {',
      '\treturn fmt.Sprint(loud)',
      '}',
      'func Map[T any](xs []T, f func(T) T) []T { return xs }',
      'type Dog struct {',
      '\tName string',
      '}',
    ].join('\n'));
    expect(sigs['Speak']).toBe('func (d *Dog) Speak(loud bool) string');
    expect(sigs['Map']).toBe('func Map[T any](xs []T, f func(T) T) []T');
    expect(sigs['Dog']).toBe('type Dog struct {');
  });

  it('Rust: generics, where clauses, multi-line parameters and structs', () => {
    const sigs = signatures('.rs', [
      'pub async fn run<T: Clone>(',
      '    items: Vec<T>,',
      ') -> Result<(), Error> where T: Send {',
      '    items.iter().for_each(|x| println!("{}", x));',
      '    Ok(())',
      '}',
      'pub struct Point<T> { x: T }',
    ].join('\n'));
    expect(sigs['run']).toBe('pub async fn run<T: Clone>(items: Vec<T>) -> Result<(), Error> where T: Send');
    expect(sigs['Point']).toBe('pub struct Point<T>');
  });

  it('Java: keeps annotations and modifiers, spans lines, and falls back to the first line without a body', () => {
    const sigs = signatures('.java', [
      'public class Repo<T extends Entity> extends Base implements Store {',
      '    @Override',
      '    public <R> List<R> find(',
      '        String id,',
      '        int limit) throws IOException {',
      '        return items.stream().map(i -> i.get()).toList();',
      '    }',
      '    abstract void gone(int a);',
      '}',
    ].join('\n'));
    expect(sigs['Repo']).toBe('public class Repo<T extends Entity> extends Base implements Store');
    expect(sigs['find']).toBe('@Override public <R> List<R> find(String id, int limit) throws IOException');
    expect(sigs['gone']).toBe('abstract void gone(int a);');
  });

  it('C#: block and expression-bodied methods', () => {
    const sigs = signatures('.cs', [
      'public class Repo<T> : Base where T : class {',
      '    public async Task<List<T>> FindAsync(',
      '        string id,',
      '        int limit) {',
      '        return items.Select(i => i).ToList();',
      '    }',
      '    public int Twice(int x) => x * 2;',
      '}',
    ].join('\n'));
    expect(sigs['Repo']).toBe('public class Repo<T> : Base where T : class');
    expect(sigs['FindAsync']).toBe('public async Task<List<T>> FindAsync(string id, int limit)');
    expect(sigs['Twice']).toBe('public int Twice(int x)');
  });

  it('C++: qualified definitions and classes', () => {
    const sigs = signatures('.cpp', [
      'template <typename T>',
      'int Widget::compute(',
      '    int a,',
      '    const std::string &s) const {',
      '  return a;',
      '}',
      'class Foo : public Bar {',
      ' public:',
      '  void run();',
      '};',
    ].join('\n'));
    expect(sigs['compute']).toBe('int Widget::compute(int a, const std::string &s) const');
    expect(sigs['Foo']).toBe('class Foo : public Bar');
  });
});
