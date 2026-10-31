import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB, type RelationQuery } from '../../../src/vectordb/db.ts';
import type { CodeChunk } from '../../../src/core/types.ts';
import type { ExtractedRelations, RawRelation, RelationKind } from '../../../src/indexer/relations.ts';

const VEC = [0.1, 0.2, 0.3, 0.4];

function chunk(name: string, position: number, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: `function ${name}() {}`, position, symbolName: name, symbolType: 'function', language: 'typescript',
    startLine: position * 10 + 1, endLine: position * 10 + 5, parentSymbol: '', signature: `function ${name}()`, ...overrides,
  };
}

function rel(type: RelationKind, sourcePosition: number, targetName: string, extra: Partial<RawRelation> = {}): RawRelation {
  return { type, sourcePosition, targetName, line: 3, ...extra };
}

const relations = (...list: RawRelation[]): ExtractedRelations => ({ relations: list, truncated: [] });

let db: VectorDB;

function put(file: string, chunks: CodeChunk[], extracted?: ExtractedRelations): void {
  db.insertCodeDocument(file, new Date(), chunks, chunks.map(() => VEC), extracted);
}

const query = (symbol: string, extra: Partial<RelationQuery> = {}): RelationQuery => ({ symbol, direction: 'both', limit: 100, offset: 0, ...extra });

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
});
afterEach(() => {
  db.close();
});

describe('call and inheritance edges', () => {
  it('resolves a callee that is defined in exactly one other file (0.9) once the pending pass ran', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'callee')));
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits[0]).toMatchObject({ targetName: 'callee', confidence: 0.3 });

    put('/p/b.ts', [chunk('callee', 0)]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('callee', { direction: 'in' })).hits[0];
    expect(hit).toMatchObject({ type: 'calls', direction: 'in', confidence: 0.9, source: { file: '/p/a.ts', name: 'caller' }, target: { file: '/p/b.ts', name: 'callee' } });
  });

  it('resolves edges to a new definition when the search reads them, without an explicit pass', () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'callee')));
    put('/p/b.ts', [chunk('callee', 0)]);
    expect(db.queryRelations(query('callee', { direction: 'in' })).hits[0]?.confidence).toBe(0.9);
  });

  it('keeps one ambiguous row (0.5, no target chunk) when several symbols share the name', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'dup')));
    put('/p/b.ts', [chunk('dup', 0)]);
    put('/p/c.ts', [chunk('dup', 0)]);
    await db.resolvePendingRelations();
    const hits = db.queryRelations(query('dup', { direction: 'in' })).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ confidence: 0.5 });
    expect(hits[0]?.target).toBeUndefined();
  });

  it('prefers the definition in the same file, then in an imported file', async () => {
    put('/p/b.ts', [chunk('dup', 0)]);
    put('/p/c.ts', [chunk('dup', 0)]);
    put('/p/same.ts', [chunk('caller', 0), chunk('dup', 1)], relations(rel('calls', 0, 'dup')));
    put('/p/imp.ts', [chunk('user', 0)], relations(rel('imports', 0, './c', { names: ['dup'] }), rel('calls', 0, 'dup')));
    await db.resolvePendingRelations();
    const byFile = new Map(db.queryRelations(query('dup', { direction: 'in', types: ['calls'] })).hits.map((h) => [h.source.file, h]));
    expect(byFile.get('/p/same.ts')).toMatchObject({ confidence: 0.9, target: { file: '/p/same.ts' } });
    expect(byFile.get('/p/imp.ts')).toMatchObject({ confidence: 0.9, target: { file: '/p/c.ts' } });
  });

  it('only resolves inheritance to class-like symbols', async () => {
    put('/p/a.ts', [chunk('Child', 0, { symbolType: 'class' })], relations(rel('inherits', 0, 'Base')));
    put('/p/b.ts', [chunk('Base', 0), chunk('Base', 1, { symbolType: 'class' })]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('Base', { direction: 'in' })).hits[0]).toMatchObject({ confidence: 0.9, target: { name: 'Base', file: '/p/b.ts' } });
  });

  it('re-resolves edges when the target file is replaced (new chunk ids) and when it is deleted', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'callee')));
    put('/p/b.ts', [chunk('callee', 0)]);
    await db.resolvePendingRelations();
    put('/p/b.ts', [chunk('callee', 0)]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('callee', { direction: 'in' })).hits[0]).toMatchObject({ confidence: 0.9, target: { file: '/p/b.ts' } });

    db.deleteDocument('/p/b.ts');
    await db.resolvePendingRelations();
    const after = db.queryRelations(query('callee', { direction: 'in' })).hits[0];
    expect(after).toMatchObject({ confidence: 0.3 });
    expect(after?.target).toBeUndefined();
  });

  it('turns an ambiguous edge into a resolved one when the other candidate is deleted', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'dup')));
    put('/p/b.ts', [chunk('dup', 0)]);
    put('/p/c.ts', [chunk('dup', 0)]);
    await db.resolvePendingRelations();
    db.deleteDocument('/p/c.ts');
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('dup', { direction: 'in' })).hits[0]).toMatchObject({ confidence: 0.9, target: { file: '/p/b.ts' } });
  });

  it('deletes the relations of a replaced or deleted source file', () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'one'), rel('calls', 0, 'two')));
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'three')));
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits.map((h) => h.targetName)).toEqual(['three']);
    expect(db.getRelationCount()).toBe(1);
    db.deleteDocument('/p/a.ts');
    expect(db.getRelationCount()).toBe(0);
  });

  it('keeps no relations for a file that is indexed without any', () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'x1')));
    put('/p/a.ts', [chunk('caller', 0)]);
    expect(db.getRelationCount()).toBe(0);
  });
});

describe('weak edges (calls to common names)', () => {
  // A name from the stop-list (format, toString, clone, ...) is almost always a library call, so it resolves only to a
  // symbol of the calling file or of a file it imports; on six real repositories every one of 30 sampled global matches was wrong.
  const weakCall = (name: string): RawRelation => rel('calls', 0, name, { weak: true });

  it('are not shown while nothing in the index has that name, and do not count', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(weakCall('format'), rel('calls', 0, 'real')));
    await db.resolvePendingRelations();
    const page = db.queryRelations(query('caller', { direction: 'out' }));
    expect(page.hits.map((h) => h.targetName)).toEqual(['real']);
    expect(page.total).toBe(1);
    expect(db.queryRelations(query('format', { direction: 'in' }))).toMatchObject({ hits: [], total: 0 });
  });

  it('show as ambiguous (0.5, no target) when only a file that is not imported has a symbol with that name (a library call)', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(weakCall('format')));
    put('/p/b.ts', [chunk('format', 0)]);
    await db.resolvePendingRelations();
    const hit = db.queryRelations(query('caller', { direction: 'out' })).hits[0];
    expect(hit).toMatchObject({ targetName: 'format', confidence: 0.5 });
    expect(hit?.target).toBeUndefined();
    db.deleteDocument('/p/b.ts');
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits).toEqual([]);
  });

  it('appear (0.9) once the calling file imports the file that has a symbol with that name, and fall back when it is deleted', async () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('imports', 0, './b', { names: ['format'] }), weakCall('format')));
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits).toEqual([]);
    put('/p/b.ts', [chunk('format', 0)]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('format', { direction: 'in', types: ['calls'] })).hits[0]).toMatchObject({ confidence: 0.9, source: { name: 'caller' }, target: { file: '/p/b.ts' } });
    db.deleteDocument('/p/b.ts');
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('caller', { direction: 'out', types: ['calls'] })).hits).toEqual([]);
  });

  it('do not add to the omitted note', () => {
    put('/p/a.ts', [chunk('caller', 0)], { relations: [weakCall('format')], truncated: [] });
    expect(db.queryRelations(query('caller', { direction: 'out' })).omitted).toEqual([]);
  });
});

describe('import edges', () => {
  it('stores the resolved file at confidence 1.0 and the raw module at 0.3 when it is not indexed', () => {
    put('/p/src/b.ts', [chunk('thing', 0)]);
    put('/p/src/a.ts', [chunk('main', 0)], relations(
      rel('imports', 0, './b.js', { names: ['thing'] }), rel('imports', 0, 'zod', { names: ['z'] }), rel('imports', 0, './gone', { names: [] }),
    ));
    const out = db.queryRelations(query('/p/src/a.ts', { direction: 'out' })).hits;
    expect(out.map((h) => [h.targetName, h.targetFile, h.confidence, h.names])).toEqual([
      ['./b.js', '/p/src/b.ts', 1, ['thing']],
      ['zod', '', 0.3, ['z']],
      ['./gone', '', 0.3, []],
    ]);
  });

  it('resolves an import when the imported file is indexed later and unresolves it when the file is deleted', async () => {
    put('/p/src/a.ts', [chunk('main', 0)], relations(rel('imports', 0, './b.js', { names: ['thing'] })));
    expect(db.queryRelations(query('/p/src/a.ts', { direction: 'out' })).hits[0]?.confidence).toBe(0.3);
    put('/p/src/b.ts', [chunk('thing', 0)]);
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('/p/src/a.ts', { direction: 'out' })).hits[0]).toMatchObject({ targetFile: '/p/src/b.ts', confidence: 1 });
    db.deleteDocument('/p/src/b.ts');
    await db.resolvePendingRelations();
    expect(db.queryRelations(query('/p/src/a.ts', { direction: 'out' })).hits[0]).toMatchObject({ targetFile: '', confidence: 0.3 });
  });

  it('finds who imports a symbol by imported name, and who imports a file', () => {
    put('/p/src/b.ts', [chunk('thing', 0)]);
    put('/p/src/a.ts', [chunk('main', 0)], relations(rel('imports', 0, './b', { names: ['thing', 'other'] })));
    put('/p/src/c.ts', [chunk('more', 0)], relations(rel('imports', 0, './b', { names: ['other'] })));
    expect(db.queryRelations(query('thing', { direction: 'in', types: ['imports'] })).hits.map((h) => h.source.file)).toEqual(['/p/src/a.ts']);
    expect(db.queryRelations(query('b.ts', { direction: 'in' })).hits.map((h) => h.source.file).sort()).toEqual(['/p/src/a.ts', '/p/src/c.ts']);
    expect(db.queryRelations(query('src/b.ts', { direction: 'in' })).total).toBe(2);
  });

  it('does not list the imports of a file as outgoing relations of its first symbol', () => {
    put('/p/src/a.ts', [chunk('main', 0)], relations(rel('imports', 0, 'zod', { names: ['z'] }), rel('calls', 0, 'helper')));
    expect(db.queryRelations(query('main', { direction: 'out' })).hits.map((h) => h.type)).toEqual(['calls']);
  });
});

describe('queryRelations', () => {
  beforeEach(() => {
    put('/p/a.ts', [chunk('run', 0, { symbolType: 'method', parentSymbol: 'Svc' }), chunk('Svc', 1, { symbolType: 'class' })], relations(
      rel('calls', 0, 'helper', { line: 7 }), rel('inherits', 1, 'Base'),
    ));
    put('/p/b.ts', [chunk('helper', 0), chunk('run', 1, { symbolType: 'method', parentSymbol: 'Other' })], relations(rel('calls', 0, 'run')));
  });

  it('matches Class.method and bare names, and narrows by Class', () => {
    const bare = db.queryRelations(query('run', { direction: 'in' }));
    expect(bare.hits.map((h) => h.source.name)).toEqual(['helper']);
    expect(db.queryRelations(query('Svc.run', { direction: 'out' })).hits[0]).toMatchObject({ targetName: 'helper', line: 7 });
    const qualified = db.queryRelations(query('Other.run', { direction: 'in' }));
    expect(qualified.hits.map((h) => h.source.name)).toEqual(['helper']);
    expect(db.queryRelations(query('Nobody.run', { direction: 'in' })).hits).toEqual([]);
  });

  it('falls back to a case-insensitive match only when the exact one finds nothing', () => {
    expect(db.queryRelations(query('HELPER', { direction: 'in' })).hits[0]?.source.name).toBe('run');
    put('/p/c.ts', [chunk('Helper', 0)], relations(rel('calls', 0, 'Helper')));
    expect(db.queryRelations(query('Helper', { direction: 'in' })).hits.map((h) => h.source.file)).toEqual(['/p/c.ts']);
  });

  it('filters by relation type and pages with limit and offset', () => {
    expect(db.queryRelations(query('Svc', { types: ['inherits'] })).hits.map((h) => h.type)).toEqual(['inherits']);
    const all = db.queryRelations(query('helper'));
    expect(all.total).toBe(2);
    const second = db.queryRelations(query('helper', { limit: 1, offset: 1 }));
    expect(second.total).toBe(2);
    expect(second.hits).toHaveLength(1);
    expect(second.hits[0]).toEqual(all.hits[1]);
  });

  it('reports how many matching symbols exist and an unknown symbol as none', () => {
    expect(db.queryRelations(query('helper')).symbols).toBe(1);
    expect(db.queryRelations(query('nothing-here')).symbols).toBe(0);
  });

  it('treats LIKE wildcards in the symbol literally', () => {
    expect(db.queryRelations(query('%')).hits).toEqual([]);
    expect(db.queryRelations(query('he_per', { direction: 'in' })).hits).toEqual([]);
  });
});

describe('relation caps', () => {
  it('reports how many calls of a chunk were left out when extracting', () => {
    put('/p/a.ts', [chunk('many', 0)], { relations: [rel('calls', 0, 'x1')], truncated: [{ sourcePosition: 0, type: 'calls', dropped: 12 }] });
    expect(db.queryRelations(query('many', { direction: 'out' })).omitted).toEqual([{ type: 'calls', count: 12 }]);
    db.deleteDocument('/p/a.ts');
    expect(db.queryRelations(query('many', { direction: 'out' })).omitted).toEqual([]);
  });
});

describe('replaceRelations (backfill for chunks that already exist)', () => {
  it('fills relations without touching chunks or vectors', () => {
    put('/p/a.ts', [chunk('caller', 0)]);
    const idBefore = db.getChunkIdBySymbol('/p/a.ts', 'caller');
    const hitsBefore = db.searchWithFilter(VEC, 5, null).map((h) => [h.document, h.position, h.similarity]);
    expect(db.replaceRelations('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'callee')))).toBe(true);
    expect(db.getChunkIdBySymbol('/p/a.ts', 'caller')).toBe(idBefore);
    expect(db.searchWithFilter(VEC, 5, null).map((h) => [h.document, h.position, h.similarity])).toEqual(hitsBefore);
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits).toHaveLength(1);
  });

  it('replaces earlier relations and refuses chunks that do not match the stored ones', () => {
    put('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'old1')));
    expect(db.replaceRelations('/p/a.ts', [chunk('caller', 0)], relations(rel('calls', 0, 'new1')))).toBe(true);
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits.map((h) => h.targetName)).toEqual(['new1']);
    expect(db.replaceRelations('/p/a.ts', [chunk('renamed', 0)], relations(rel('calls', 0, 'new2')))).toBe(false);
    expect(db.replaceRelations('/p/a.ts', [chunk('caller', 0), chunk('extra', 1)], relations(rel('calls', 1, 'new3')))).toBe(false);
    expect(db.replaceRelations('/p/unknown.ts', [chunk('caller', 0)], relations())).toBe(false);
    expect(db.queryRelations(query('caller', { direction: 'out' })).hits.map((h) => h.targetName)).toEqual(['new1']);
  });
});

describe('relations version', () => {
  it('is null on a database that never recorded it and round-trips', () => {
    expect(db.getRelationsVersion()).toBeNull();
    db.setRelationsVersion(1);
    expect(db.getRelationsVersion()).toBe(1);
  });
});
