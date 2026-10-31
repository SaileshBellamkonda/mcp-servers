import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';
import type { ExtractedRelations } from '../../../src/indexer/relations.ts';
import type { CodeChunk } from '../../../src/core/types.ts';

let parser: CodeParser;
let dir: string;

beforeAll(() => {
  parser = new CodeParser();
  dir = mkdtempSync(path.join(tmpdir(), 'coderag-rel-'));
});
afterAll(() => {
  parser.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Parsed {
  chunks: CodeChunk[];
  relations: ExtractedRelations;
  /** `type source->target` with the source chunk's symbol name; imports are listed as `imports module [names]`. */
  lines: string[];
  /** Calls to common names that no symbol of the file defines: kept only if the index can resolve them. */
  weak: string[];
}

function parse(fileName: string, source: string): Parsed {
  const file = path.join(dir, fileName);
  writeFileSync(file, source);
  const { chunks, relations } = parser.parseFileWithRelations(file);
  const describe = (r: (typeof relations.relations)[number]): string => `${r.type} ${chunks[r.sourcePosition]?.symbolName ?? '?'}->${r.targetName}`;
  const weak = relations.relations.filter((r) => r.weak === true).map(describe);
  const lines = relations.relations.filter((r) => r.weak !== true).map((r) => {
    if (r.type === 'imports') return `imports ${r.targetName} [${(r.names ?? []).join(',')}]`;
    return `${r.type} ${chunks[r.sourcePosition]?.symbolName ?? '?'}->${r.targetName}`;
  });
  return { chunks, relations, lines, weak };
}

const only = (lines: string[], type: string): string[] => lines.filter((l) => l.startsWith(`${type} `));

describe('relations: TypeScript', () => {
  const source = `import { b as c, type D } from './x.js';
import def, * as ns from 'y';
import './z';
export { q } from './w';
export * from './all';
const r = require('fs');
export class A extends B<T> implements I, J.K {
  m(): void { this.foo(1); bar(); new Baz(); a.b.cee(); items.map((x) => x); console.log(1); this.foo(2); }
}
interface I2 extends I, J {}
function top() { helper(); }
helper2();
`;

  it('records import statements with their module and imported names', () => {
    const { lines } = parse('a.ts', source);
    expect(only(lines, 'imports')).toEqual([
      'imports ./x.js [b,D]',
      'imports y [def,*]',
      'imports ./z []',
      'imports ./w [q]',
      'imports ./all [*]',
      'imports fs []',
    ]);
  });

  it('attributes imports to the first chunk of the file and gives each relation its line', () => {
    const { relations } = parse('a2.ts', source);
    const imports = relations.relations.filter((r) => r.type === 'imports');
    expect(imports.every((r) => r.sourcePosition === 0)).toBe(true);
    expect(imports.map((r) => r.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('records extends, implements and interface extends with the bare type name', () => {
    const { lines } = parse('a3.ts', source);
    expect(only(lines, 'inherits')).toEqual(['inherits A->B', 'inherits A->I', 'inherits A->K', 'inherits I2->I', 'inherits I2->J']);
  });

  it('attributes calls to the enclosing function, deduplicated, constructor calls included, builtins skipped', () => {
    const { lines } = parse('a4.ts', source);
    expect(only(lines, 'calls')).toEqual(['calls m->foo', 'calls m->bar', 'calls m->Baz', 'calls m->cee', 'calls top->helper']);
  });

  it('ignores calls outside any function or class', () => {
    const { lines } = parse('a5.ts', source);
    expect(lines.join('\n')).not.toContain('helper2');
  });

  it('records the line of a call', () => {
    const { relations } = parse('a6.ts', source);
    expect(relations.relations.find((r) => r.type === 'calls' && r.targetName === 'helper')?.line).toBe(11);
  });

  it('records no relations for a file without symbols', () => {
    const { relations } = parse('a7.ts', "import x from './x';\nx();\n");
    expect(relations.relations).toEqual([]);
  });

  it('caps calls per source chunk and counts what was left out', () => {
    const calls = Array.from({ length: 60 }, (_, i) => `callee${String(i)}();`).join(' ');
    const { relations, lines } = parse('a8.ts', `function many() { ${calls} }\n`);
    expect(only(lines, 'calls')).toHaveLength(50);
    expect(relations.truncated).toEqual([{ sourcePosition: 0, type: 'calls', dropped: 10 }]);
  });
});

describe('relations: TSX and JavaScript', () => {
  it('extracts from TSX with the tsx grammar', () => {
    const { lines } = parse('b.tsx', `import { Button } from './button';
export function Page() { const el = <Button onClick={() => save()} />; return render(el); }
`);
    expect(only(lines, 'imports')).toEqual(['imports ./button [Button]']);
    expect(only(lines, 'calls')).toEqual(['calls Page->save', 'calls Page->render']);
  });

  it('extracts classes, dynamic imports and require from JavaScript', () => {
    const { lines } = parse('c.js', `const fs = require('node:fs');
import('./lazy.js');
class Dog extends Animal { bark() { this.makeNoise(); } }
`);
    expect(only(lines, 'imports')).toEqual(['imports node:fs []', 'imports ./lazy.js []']);
    expect(only(lines, 'inherits')).toEqual(['inherits Dog->Animal']);
    expect(only(lines, 'calls')).toEqual(['calls bark->makeNoise']);
  });
});

describe('relations: Python', () => {
  const source = `import os, sys as s
import a.b.c
from . import x
from .mod import y, z as w
from ..pkg.m import *
from a.b import c
class A(B, mod.C, metaclass=M):
    def f(self):
        self.gee(1)
        hoo()
        a.b.cee()
        v = Foo()
        print(len(v))
`;

  it('records imports with relative dots kept in the module', () => {
    const { lines } = parse('p.py', source);
    expect(only(lines, 'imports')).toEqual([
      'imports os []', 'imports sys []', 'imports a.b.c []', 'imports .x []',
      'imports .mod [y,z]', 'imports ..pkg.m [*]', 'imports a.b [c]',
    ]);
  });

  it('records base classes (keyword arguments are not bases) and calls', () => {
    const { lines } = parse('p2.py', source);
    expect(only(lines, 'inherits')).toEqual(['inherits A->B', 'inherits A->C']);
    expect(only(lines, 'calls')).toEqual(['calls f->gee', 'calls f->hoo', 'calls f->cee', 'calls f->Foo']);
  });
});

describe('relations: Go', () => {
  const source = `package p
import (
  "fmt"
  u "github.com/x/y/util"
)
type S struct {
  Base
  *Other
  pkg.Ext
  name string
}
type I interface {
  Reader
  io.Closer
  Foo() int
}
func (s *S) M() { fmt.Println(1); s.helper(); Launch(); u.Do() }
`;

  it('records import paths', () => {
    expect(only(parse('g.go', source).lines, 'imports')).toEqual(['imports fmt []', 'imports github.com/x/y/util []']);
  });

  it('records embedded structs and interfaces as inheritance', () => {
    expect(only(parse('g2.go', source).lines, 'inherits')).toEqual([
      'inherits S->Base', 'inherits S->Other', 'inherits S->Ext', 'inherits I->Reader', 'inherits I->Closer',
    ]);
  });

  it('records calls with the selector name', () => {
    expect(only(parse('g3.go', source).lines, 'calls')).toEqual(['calls M->helper', 'calls M->Launch', 'calls M->Do']);
  });
});

describe('relations: Rust', () => {
  const source = `use crate::a::b::Name;
use super::x::{Y, Z as W};
use std::io;
use self::m::*;
mod foo;
struct S;
trait T: Super + Other {}
impl Display for S { fn f(&self) { aaa(); self.bbb(); m::ccc(); Vec::new(); println!("x"); x.y.zzz(); foo::<u8>(); } }
`;

  it('flattens use declarations into module and names', () => {
    expect(only(parse('r.rs', source).lines, 'imports')).toEqual([
      'imports crate::a::b [Name]', 'imports super::x [Y,Z]', 'imports std [io]', 'imports self::m [*]', 'imports self::foo []',
    ]);
  });

  it('records trait bounds and impl Trait for Type as inheritance', () => {
    expect(only(parse('r2.rs', source).lines, 'inherits')).toEqual(['inherits T->Super', 'inherits T->Other', 'inherits S->Display']);
  });

  it('records calls of functions, methods and paths, skipping macros and builtins', () => {
    expect(only(parse('r3.rs', source).lines, 'calls')).toEqual(['calls f->aaa', 'calls f->bbb', 'calls f->ccc', 'calls f->zzz', 'calls f->foo']);
  });
});

describe('relations: Java', () => {
  const source = `package a.b;
import java.util.List;
import static com.foo.Util.helper;
import com.baz.*;
public class A<T> extends B<T> implements I, J.K { void m() { foo(); this.bar(); x.y.baz(); new Qux(); super.go(); } }
interface I2 extends I, J {}
`;

  it('records imports, static imports and wildcards', () => {
    expect(only(parse('A.java', source).lines, 'imports')).toEqual([
      'imports java.util.List []', 'imports com.foo.Util [helper]', 'imports com.baz [*]',
    ]);
  });

  it('records superclass, interfaces and interface extends', () => {
    expect(only(parse('A2.java', source).lines, 'inherits')).toEqual(['inherits A->B', 'inherits A->I', 'inherits A->K', 'inherits I2->I', 'inherits I2->J']);
  });

  it('records method invocations and object creation', () => {
    expect(only(parse('A3.java', source).lines, 'calls')).toEqual(['calls m->foo', 'calls m->bar', 'calls m->baz', 'calls m->Qux', 'calls m->go']);
  });
});

describe('relations: C#', () => {
  const source = `using System;
using System.Collections.Generic;
using Alias = Foo.Bar;
using static Foo.Util;
namespace N { class A<T> : B<T>, IFoo, Ns.IBar { void M() { Foo(); this.Bar(); x.y.Baz(); new Qux(); base.Go(); Gen<int>(); x?.Zed(); } }
interface I2 : I, J {} }
`;

  it('records using directives', () => {
    expect(only(parse('a.cs', source).lines, 'imports')).toEqual([
      'imports System []', 'imports System.Collections.Generic []', 'imports Foo.Bar []', 'imports Foo.Util []',
    ]);
  });

  it('records base lists', () => {
    expect(only(parse('a2.cs', source).lines, 'inherits')).toEqual(['inherits A->B', 'inherits A->IFoo', 'inherits A->IBar', 'inherits I2->I', 'inherits I2->J']);
  });

  it('records invocations and object creation', () => {
    expect(only(parse('a3.cs', source).lines, 'calls')).toEqual(['calls M->Foo', 'calls M->Bar', 'calls M->Baz', 'calls M->Qux', 'calls M->Go', 'calls M->Gen', 'calls M->Zed']);
  });
});

describe('relations: calls to common names', () => {
  it('keeps a call to a common name when the same file defines it (Go format, Java print, Python format, Rust parse, TypeScript log)', () => {
    expect(only(parse('w.go', 'package p\nfunc format(r int) string { return "" }\nfunc Handle(r int) string { return format(r) }\n').lines, 'calls')).toEqual(['calls Handle->format']);
    expect(only(parse('W.java', 'class Printer { void print(int x) {} }\nclass App { void report(Printer p) { p.print(1); } }\n').lines, 'calls')).toEqual(['calls report->print']);
    expect(only(parse('w.py', 'def format(x):\n    return x\ndef handle(x):\n    return format(x)\n').lines, 'calls')).toEqual(['calls handle->format']);
    expect(only(parse('w.rs', 'fn parse(s: &str) -> u32 { 1 }\nfn run(s: &str) -> u32 { parse(s) }\n').lines, 'calls')).toEqual(['calls run->parse']);
    expect(only(parse('w.ts', 'class Svc { log(m: string) {} run() { this.log("x"); } }\n').lines, 'calls')).toEqual(['calls run->log']);
  });

  it('marks other calls to common names as weak instead of dropping them', () => {
    const parsed = parse('w2.ts', 'function f(items: number[]) { items.map((x) => x); console.log(1); own(); }\n');
    expect(only(parsed.lines, 'calls')).toEqual(['calls f->own']);
    expect(parsed.weak).toEqual(['calls f->map', 'calls f->log']);
  });

  it('does not count weak calls against the cap or in the dropped note', () => {
    const noise = Array.from({ length: 70 }, () => 'items.push(1);').join(' ');
    const names = Array.from({ length: 70 }, (_, i) => `x.push${String(i)}();`).join(' ');
    const parsed = parse('w3.ts', `function f(items: number[], x: any) { ${noise} ${names} real(); }\n`);
    expect(only(parsed.lines, 'calls')).toHaveLength(50);
    expect(parsed.relations.truncated).toEqual([{ sourcePosition: 0, type: 'calls', dropped: 21 }]);
  });
});

describe('relations: other languages', () => {
  it('leaves PHP, C and Ruby without relations and without error', () => {
    expect(parse('x.php', '<?php function f() { g(); }').relations.relations).toEqual([]);
    expect(parse('x.c', 'int f(void) { g(); return 0; }').relations.relations).toEqual([]);
    expect(parse('x.rb', 'def f\n  g\nend\n').relations.relations).toEqual([]);
  });

  it('parseFile still returns the chunks only', () => {
    const file = path.join(dir, 'plain.ts');
    writeFileSync(file, 'export function plain() { other(); }\n');
    expect(parser.parseFile(file).map((c) => c.symbolName)).toEqual(['plain']);
  });
});
