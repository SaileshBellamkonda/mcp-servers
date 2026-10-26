import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB, type RelationQuery } from '../../../src/vectordb/db.js';
import type { CodeChunk } from '../../../src/core/types.js';
import type { ExtractedRelations, RawRelation, RelationKind } from '../../../src/indexer/relations.js';

const VEC = [0.1, 0.2, 0.3, 0.4];

function chunk(name: string, position: number, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: `function ${name}() {}`, position, symbolName: name, symbolType: 'function', language: 'java',
    startLine: position * 10 + 1, endLine: position * 10 + 5, parentSymbol: '', signature: `${name}()`, ...overrides,
  };
}

function rel(type: RelationKind, sourcePosition: number, targetName: string, extra: Partial<RawRelation> = {}): RawRelation {
  return { type, sourcePosition, targetName, line: 3, ...extra };
}

const relations = (...list: RawRelation[]): ExtractedRelations => ({ relations: list, truncated: [] });
const query = (symbol: string, extra: Partial<RelationQuery> = {}): RelationQuery => ({ symbol, direction: 'both', limit: 100, offset: 0, ...extra });

let db: VectorDB;

function put(file: string, chunks: CodeChunk[], extracted?: ExtractedRelations): void {
  db.insertCodeDocument(file, new Date(), chunks, chunks.map(() => VEC), extracted);
}

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
});
afterEach(() => {
  db.close();
});

describe('inheritance edges never point at their own class', () => {
  it('leaves `class Config extends lib.Config` unresolved when no other Config is indexed', async () => {
    put('/p/a.java', [chunk('Config', 0, { symbolType: 'class' })], relations(rel('inherits', 0, 'Config')));
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('Config', { direction: 'out', types: ['inherits'] })).hits[0];
    expect(hit).toMatchObject({ targetName: 'Config', confidence: 0.3 });
    expect(hit?.target).toBeUndefined();
  });

  it('resolves it to another class of the same name when there is one', async () => {
    put('/p/a.java', [chunk('Config', 0, { symbolType: 'class' })], relations(rel('inherits', 0, 'Config')));
    put('/p/b.java', [chunk('Config', 0, { symbolType: 'class' })]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('Config', { direction: 'out', types: ['inherits'] })).hits[0];
    expect(hit).toMatchObject({ confidence: 0.9, target: { file: '/p/b.java', name: 'Config' } });
  });
});

describe('overloads and constructors are one target', () => {
  it('resolves a call to a method with several overloads in one class (0.9, the first overload)', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(rel('calls', 0, 'fromJson')));
    put('/p/b.java', [
      chunk('Gson', 0, { symbolType: 'class' }),
      chunk('fromJson', 1, { symbolType: 'method', parentSymbol: 'Gson' }),
      chunk('fromJson', 2, { symbolType: 'method', parentSymbol: 'Gson' }),
      chunk('fromJson', 3, { symbolType: 'method', parentSymbol: 'Gson' }),
    ]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0];
    expect(hit).toMatchObject({ confidence: 0.9, target: { file: '/p/b.java', name: 'fromJson', parent: 'Gson', startLine: 11 } });
  });

  it('keeps overloads of different classes ambiguous', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(rel('calls', 0, 'write')));
    put('/p/b.java', [chunk('write', 0, { symbolType: 'method', parentSymbol: 'Reader' }), chunk('write', 1, { symbolType: 'method', parentSymbol: 'Reader' })]);
    put('/p/c.java', [chunk('write', 0, { symbolType: 'method', parentSymbol: 'Writer' })]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.5 });
  });

  it('resolves `new Foo()` to the class, not ambiguously to the class and its constructors', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(rel('calls', 0, 'Foo')));
    put('/p/b.java', [
      chunk('Foo', 0, { symbolType: 'class' }),
      chunk('Foo', 1, { symbolType: 'function', parentSymbol: 'Foo' }),
      chunk('Foo', 2, { symbolType: 'function', parentSymbol: 'Foo' }),
    ]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0];
    expect(hit).toMatchObject({ confidence: 0.9, target: { file: '/p/b.java', name: 'Foo', startLine: 1 } });
  });

  it('keeps a class and a same-named function elsewhere ambiguous', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(rel('calls', 0, 'Foo')));
    put('/p/b.java', [chunk('Foo', 0, { symbolType: 'class' })]);
    put('/p/c.java', [chunk('Foo', 0, { symbolType: 'function' })]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.5 });
  });
});

describe('a qualified call prefers the class or module it names', () => {
  it('resolves `GsonTypes.getRawType(x)` to the method of GsonTypes, not to a same-named method of the calling class', async () => {
    put('/p/internal/GsonTypes.java', [chunk('getRawType', 0, { symbolType: 'method', parentSymbol: 'GsonTypes' })]);
    put('/p/reflect/TypeToken.java', [
      chunk('caller', 0, { symbolType: 'method', parentSymbol: 'TypeToken' }),
      chunk('getRawType', 1, { symbolType: 'method', parentSymbol: 'TypeToken' }),
    ], relations(rel('calls', 0, 'getRawType', { qualifier: 'GsonTypes' })));
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('TypeToken.caller', { direction: 'out', types: ['calls'] })).hits[0];
    expect(hit).toMatchObject({ confidence: 0.9, target: { file: '/p/internal/GsonTypes.java', parent: 'GsonTypes' } });
  });

  it('resolves `flask.views.View` by the file name of the module and `flask.Flask` by the name of its folder', async () => {
    const klass = (name: string): CodeChunk => chunk(name, 0, { symbolType: 'class', language: 'python' });
    put('/p/src/flask/views.py', [klass('View')]);
    put('/p/src/flask/app.py', [klass('Flask')]);
    put('/p/tests/test_views.py', [klass('View'), chunk('Flask', 1, { symbolType: 'class', language: 'python' }), chunk('Index', 2, { symbolType: 'class', language: 'python' })],
      relations(rel('inherits', 2, 'View', { qualifier: 'views' }), rel('calls', 2, 'Flask', { qualifier: 'flask' })));
    await db.resolvePendingRelations();
    const out = db.queryRelations(query('Index', { direction: 'out' })).hits;
    expect(out.find((h) => h.type === 'inherits')).toMatchObject({ confidence: 0.9, target: { file: '/p/src/flask/views.py' } });
    expect(out.find((h) => h.type === 'calls')).toMatchObject({ confidence: 0.9, target: { file: '/p/src/flask/app.py' } });
  });

  it('keeps the same-file preference when the qualifier names no candidate (a variable)', async () => {
    put('/p/a.java', [chunk('caller', 0), chunk('add', 1, { symbolType: 'method', parentSymbol: 'Local' })], relations(rel('calls', 0, 'add', { qualifier: 'items' })));
    put('/p/b.java', [chunk('add', 0, { symbolType: 'method', parentSymbol: 'Other' })]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.9, target: { file: '/p/a.java', parent: 'Local' } });
  });
});

describe('a function nested in another function is not visible outside it', () => {
  const outer = chunk('timedOut', 0, { startLine: 10, endLine: 60 });
  const inner = chunk('once', 1, { startLine: 20, endLine: 24 });

  it('is not the target of a call from another file', async () => {
    put('/p/timed-out.ts', [outer, inner]);
    put('/p/other.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'once')));
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0];
    expect(hit).toMatchObject({ targetName: 'once', confidence: 0.3 });
    expect(hit?.target).toBeUndefined();
  });

  it('is the target of calls from inside the enclosing function but not from elsewhere in its file', async () => {
    put('/p/timed-out.ts', [outer, inner, chunk('handler', 2, { startLine: 30, endLine: 35 }), chunk('later', 3, { startLine: 70, endLine: 80 })],
      relations(rel('calls', 2, 'once'), rel('calls', 3, 'once')));
    await db.resolvePendingRelations();
    const calls = db.queryRelations(query('once', { direction: 'in', types: ['calls'] })).hits;
    expect(calls.filter((h) => h.target).map((h) => h.source.name)).toEqual(['handler']);
    expect(calls.find((h) => h.source.name === 'handler')).toMatchObject({ confidence: 0.9, target: { name: 'once' } });
    expect(calls.find((h) => h.source.name === 'later')).toMatchObject({ confidence: 0.3 });
  });

  it('does not hide a method of a class, nor a function nested only in a class', async () => {
    put('/p/a.ts', [chunk('Box', 0, { symbolType: 'class', startLine: 1, endLine: 50 }), chunk('open', 1, { symbolType: 'method', parentSymbol: 'Box', startLine: 5, endLine: 9 })]);
    put('/p/b.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'open')));
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.9, target: { name: 'open', parent: 'Box' } });
  });
});

describe('calls to common names resolve only through the file itself or an import', () => {
  const weakCall = (name: string): RawRelation => rel('calls', 0, name, { weak: true });

  it('does not attach `value.toString()` to the only toString the index happens to define: the name shows as ambiguous (0.5) without a target', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(weakCall('toString')));
    put('/p/b.java', [chunk('toString', 0, { symbolType: 'method', parentSymbol: 'Number' })]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('caller', { direction: 'out' })).hits[0];
    expect(hit).toMatchObject({ targetName: 'toString', confidence: 0.5 });
    expect(hit?.target).toBeUndefined();
  });

  it('is ambiguous (0.5, no target) when several symbols have the name, and hidden when none has it', async () => {
    put('/p/a.java', [chunk('caller', 0)], relations(weakCall('contains'), weakCall('nowhere')));
    put('/p/b.java', [chunk('contains', 0)]);
    put('/p/c.java', [chunk('contains', 0)]);
    await db.resolvePendingRelations();
    const hits = db.queryRelations(query('caller', { direction: 'out' })).hits;
    expect(hits.map((h) => `${h.targetName}:${String(h.confidence)}`)).toEqual(['contains:0.5']);
  });

  it('is shown with its target (0.9) when the calling file imports the file that defines the name', async () => {
    put('/p/util.ts', [chunk('close', 0, { language: 'typescript' })]);
    put('/p/other.ts', [chunk('close', 0, { language: 'typescript' })]);
    put('/p/a.ts', [chunk('caller', 0, { language: 'typescript' })], relations(rel('imports', 0, './util', { names: ['close'] }), weakCall('close')));
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.9, target: { file: '/p/util.ts' } });
  });
});

describe('a common name resolves through an import only to what the import brings in', () => {
  const weakCall = (name: string): RawRelation => rel('calls', 0, name, { weak: true });
  const setup = (importedNames: string[], member: boolean): void => {
    put('/p/types.ts', [
      chunk('Selection', 0, { symbolType: 'class', language: 'typescript' }),
      chunk('map', 1, member ? { symbolType: 'method', parentSymbol: 'Selection', language: 'typescript' } : { language: 'typescript' }),
    ]);
    put('/p/a.ts', [chunk('caller', 0, { language: 'typescript' })], relations(rel('imports', 0, './types', { names: importedNames }), weakCall('map')));
  };
  const resolved = (): ReturnType<VectorDB['queryRelations']>['hits'][number] | undefined => db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits[0];
  const fresh = (): void => {
    db.close();
    db = VectorDB.open(':memory:', 4);
  };

  it('does not take `opt.map(f)` for Selection.map because the file imports Types, or Selection itself, from the same module', async () => {
    for (const names of [['Types'], ['Selection'], ['*'], []]) {
      fresh();
      setup(names, true);
      await db.resolvePendingRelations();
      expect(resolved(), `names ${JSON.stringify(names)}`).toMatchObject({ confidence: 0.5 });
      expect(resolved()?.target).toBeUndefined();
    }
  });

  it('takes a method only when the import names it', async () => {
    setup(['map'], true);
    await db.resolvePendingRelations();
    expect(resolved()).toMatchObject({ confidence: 0.9, target: { name: 'map', parent: 'Selection' } });
  });

  it('takes a plain function when the import names it, is a wildcard or brings the whole module', async () => {
    for (const names of [['map'], ['*'], []]) {
      fresh();
      setup(names, false);
      await db.resolvePendingRelations();
      expect(resolved(), `names ${JSON.stringify(names)}`).toMatchObject({ confidence: 0.9, target: { name: 'map', file: '/p/types.ts' } });
    }
    fresh();
    setup(['Types'], false);
    await db.resolvePendingRelations();
    expect(resolved()).toMatchObject({ confidence: 0.5 });
    expect(resolved()?.target).toBeUndefined();
  });
});

describe('an impl block does not inherit from the type it implements', () => {
  it('leaves `impl std::error::Error for Error` unresolved instead of pointing at struct Error of the same file', async () => {
    put('/p/error.rs', [chunk('Error', 0, { symbolType: 'struct', language: 'rust' }), chunk('Error', 1, { symbolType: 'struct', language: 'rust' })], relations(rel('inherits', 1, 'Error')));
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('Error', { direction: 'out', types: ['inherits'] })).hits[0];
    expect(hit).toMatchObject({ confidence: 0.3 });
    expect(hit?.target).toBeUndefined();
  });
});

describe('an import is resolved again when a closer file of the same name is indexed later', () => {
  const rust = (name: string): CodeChunk => chunk(name, 0, { language: 'rust' });
  const importedFile = (): string | undefined => db.queryRelations(query('/r/crates/printer/src/standard.rs', { direction: 'out', types: ['imports'] })).hits[0]?.targetFile;

  it('moves `use crate::util` from another crate\'s util.rs to the one of its own crate', async () => {
    put('/r/crates/matcher/tests/util.rs', [rust('helper')]);
    put('/r/crates/printer/src/standard.rs', [rust('Standard')], relations(rel('imports', 0, 'crate::util', { names: ['Replacer'] })));
    await db.resolvePendingRelations();
    expect(importedFile()).toBe('/r/crates/matcher/tests/util.rs');

    put('/r/crates/printer/src/util.rs', [rust('Replacer')]);
    await db.resolvePendingRelations();
    expect(importedFile()).toBe('/r/crates/printer/src/util.rs');
  });

  it('gives the import back to the farther file when the closer one is deleted', async () => {
    put('/r/crates/matcher/tests/util.rs', [rust('helper')]);
    put('/r/crates/printer/src/util.rs', [rust('Replacer')]);
    put('/r/crates/printer/src/standard.rs', [rust('Standard')], relations(rel('imports', 0, 'crate::util', { names: ['Replacer'] })));
    await db.resolvePendingRelations();
    expect(importedFile()).toBe('/r/crates/printer/src/util.rs');
    db.deleteDocument('/r/crates/printer/src/util.rs');
    await db.resolvePendingRelations();
    expect(importedFile()).toBe('/r/crates/matcher/tests/util.rs');
  });
});
