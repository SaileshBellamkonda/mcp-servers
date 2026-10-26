import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.js';

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-qualifier-'));
});
afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

/** `name` or `qualifier.name` of every recorded call or base type, in a stable order. */
function qualified(fileName: string, source: string, type: 'calls' | 'inherits' = 'calls'): string[] {
  const file = path.join(dir, fileName);
  writeFileSync(file, source);
  return parser
    .parseFileWithRelations(file)
    .relations.relations.filter((r) => r.type === type)
    .map((r) => (r.qualifier === undefined ? r.targetName : `${r.qualifier}.${r.targetName}`))
    .sort();
}

describe('the qualifier of a call is the name written before it', () => {
  it('TypeScript: a type or variable, the last name of a longer path, nothing for this, calls and plain calls', () => {
    expect(qualified('a.ts', 'function f() { Foo.bar(); alpha.beta.gamma(); this.delta(); epsilon(); zeta().eta(); new Baz(); x["y"](); }')).toEqual(['Baz', 'Foo.bar', 'beta.gamma', 'delta', 'epsilon', 'eta', 'zeta']);
  });

  it('Python: modules and objects, nothing for self, cls and super()', () => {
    expect(qualified('a.py', 'def f(self):\n    flask.Flask(1)\n    os.path.join(a)\n    self.run()\n    super().init()\n    plain()\n')).toEqual(['flask.Flask', 'init', 'path.join', 'plain', 'run', 'super']);
  });

  it('Java: a class or variable before the method, nothing for this or super', () => {
    expect(qualified('A.java', 'class A { void m() { GsonTypes.getRawType(x); list.add(1); this.run(); super.close(); helper(); } }')).toEqual(['GsonTypes.getRawType', 'close', 'helper', 'list.add', 'run']);
  });

  it('C#: a class before a (generic) method, nothing for this and base', () => {
    expect(qualified('A.cs', 'class A { void M() { ReflectionUtils.GetAttribute<int>(p); this.Run(); base.Stop(); Helper(); } }')).toEqual(['Helper', 'ReflectionUtils.GetAttribute', 'Run', 'Stop']);
  });

  it('Rust: the type or module of a path call and the field of a method call, nothing for self and Self', () => {
    expect(qualified('a.rs', 'fn f() { Foo::new(); convert::usize(v); self.config(); Self::helper(); xs.ys.zs(); plain(); }')).toEqual(['Foo.new', 'config', 'convert.usize', 'helper', 'plain', 'ys.zs']);
  });

  it('Go: a package or variable before the call', () => {
    expect(qualified('a.go', 'package p\nfunc f() { strings.ToUpper(s); c.Name(); aa.bb.Cc(); plain() }')).toEqual(['bb.Cc', 'c.Name', 'plain', 'strings.ToUpper']);
  });

  it('records the module of a qualified base class', () => {
    expect(qualified('b.py', 'class Index(flask.views.View):\n    pass\nclass Plain(Base):\n    pass\n', 'inherits')).toEqual(['Base', 'views.View']);
    expect(qualified('b.ts', 'class A extends ns.Base {}\nclass B extends Root {}', 'inherits')).toEqual(['Root', 'ns.Base']);
  });
});
