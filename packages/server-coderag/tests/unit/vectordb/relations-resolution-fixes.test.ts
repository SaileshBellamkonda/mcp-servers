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

function rel(type: RelationKind, sourcePosition: number, targetName: string): RawRelation {
  return { type, sourcePosition, targetName, line: 3 };
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
