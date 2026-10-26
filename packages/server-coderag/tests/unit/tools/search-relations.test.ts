import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import type { CodeChunk } from '../../../src/core/types.js';
import type { RawRelation, RelationKind } from '../../../src/indexer/relations.js';
import { registerSearchRelations } from '../../../src/tools/search-relations.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const root = path.resolve('/work/project');
const file = (name: string): string => path.join(root, 'src', name);
const VEC = [0.1, 0.2, 0.3, 0.4];

function chunk(name: string, position: number, extra: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: `function ${name}() {}`, position, symbolName: name, symbolType: 'function', language: 'typescript',
    startLine: position * 10 + 1, endLine: position * 10 + 5, parentSymbol: '', signature: `function ${name}()`, ...extra,
  };
}
const rel = (type: RelationKind, sourcePosition: number, targetName: string, line: number, names?: string[]): RawRelation => ({ type, sourcePosition, targetName, line, ...(names ? { names } : {}) });

let db: VectorDB;
let handler: Handler;
let description = '';
let inputSchema: unknown;

async function call(input: Record<string, unknown>): Promise<string> {
  return (await handler(input)).content[0]?.text ?? '';
}

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  db.insertCodeDocument(file('a.ts'), new Date(), [chunk('run', 0, { symbolType: 'method', parentSymbol: 'Svc' }), chunk('Svc', 1, { symbolType: 'class' })], [VEC, VEC], {
    relations: [rel('calls', 0, 'helper', 7), rel('inherits', 1, 'Base', 11), rel('imports', 0, './b', 1, ['helper'])],
    truncated: [{ sourcePosition: 0, type: 'calls', dropped: 4 }],
  });
  db.insertCodeDocument(file('b.ts'), new Date(), [chunk('helper', 0), chunk('Base', 1, { symbolType: 'class' })], [VEC, VEC]);
  db.insertCodeDocument(file('c.ts'), new Date(), [chunk('top', 0)], [VEC], {
    relations: [rel('calls', 0, 'run', 3), rel('calls', 0, 'fetchIt', 4)],
    truncated: [],
  });
  db.insertCodeDocument(path.resolve('/outside/lib/x.ts'), new Date(), [chunk('ext', 0)], [VEC], { relations: [rel('calls', 0, 'helper', 9)], truncated: [] });
  const server = {
    registerTool: (_name: string, config: { description: string; inputSchema: unknown }, h: Handler): void => {
      handler = h;
      description = config.description;
      inputSchema = config.inputSchema;
    },
  } as unknown as McpServer;
  registerSearchRelations(server, db, new PathGuard([root]));
});

afterEach(() => { db.close(); });

describe('search_relations (concise)', () => {
  it('lists callers and importers of a symbol, one line each, with relative paths', async () => {
    expect(await call({ symbol: 'helper' })).toBe([
      'imports  src/a.ts:1 -> ./b [src/b.ts] {helper} (1.00)',
      'calls  …/lib/x.ts:9 ext -> helper [src/b.ts:1] (0.90)',
      'calls  src/a.ts:7 Svc.run -> helper [src/b.ts:1] (0.90)',
    ].join('\n'));
  });

  it('lists what a method calls, Class.method form', async () => {
    const text = await call({ symbol: 'Svc.run', direction: 'out' });
    expect(text.split('\n')[0]).toBe('calls  src/a.ts:7 Svc.run -> helper [src/b.ts:1] (0.90)');
  });

  it('says how many calls of the symbol were not recorded', async () => {
    expect(await call({ symbol: 'Svc.run', direction: 'out' })).toContain('+4 calls not recorded (cap of 50 per symbol)');
  });

  it('lists the imports of a file', async () => {
    expect(await call({ symbol: 'src/a.ts', direction: 'out' })).toBe('imports  src/a.ts:1 -> ./b [src/b.ts] {helper} (1.00)');
  });

  it('lists who imports a file', async () => {
    expect(await call({ symbol: 'b.ts', direction: 'in' })).toBe('imports  src/a.ts:1 -> ./b [src/b.ts] {helper} (1.00)');
  });

  it('lists subclasses', async () => {
    expect(await call({ symbol: 'Base', relation_type: 'inherits' })).toBe('inherits  src/a.ts:11 Svc -> Base [src/b.ts:11] (0.90)');
  });

  it('separates outgoing and incoming relations when a symbol has both', async () => {
    expect(await call({ symbol: 'run' })).toBe([
      'outgoing:',
      'calls  src/a.ts:7 Svc.run -> helper [src/b.ts:1] (0.90)',
      '+4 calls not recorded (cap of 50 per symbol)',
      'incoming:',
      'calls  src/c.ts:3 top -> Svc.run [src/a.ts:1] (0.90)',
    ].join('\n'));
  });

  it('shows the raw name of an unresolved target and no path', async () => {
    const text = await call({ symbol: 'top', direction: 'out' });
    expect(text).toContain('calls  src/c.ts:3 top -> Svc.run [src/a.ts:1] (0.90)');
    expect(text).toContain('calls  src/c.ts:4 top -> fetchIt (0.30)');
  });

  it('stays within max_tokens and tells how to continue', async () => {
    const text = await call({ symbol: 'helper', max_tokens: 30 });
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toMatch(/\n\+2 more; narrow with relation_type or direction, or pass offset=1$/);
    const next = await call({ symbol: 'helper', max_tokens: 30, offset: 1 });
    expect(next.split('\n')[0]).toContain('…/lib/x.ts:9');
  });

  it('answers an unknown symbol with a short hint to use search', async () => {
    const text = await call({ symbol: 'doesNotExist' });
    expect(text).toMatch(/^No indexed symbol or file matches "doesNotExist"/);
    expect(text).toContain('search');
    expect(text.length).toBeLessThan(220);
  });

  it('answers a known symbol without relations with a hint, not an empty string', async () => {
    const text = await call({ symbol: 'Base', direction: 'out' });
    expect(text).toMatch(/^No outgoing relations recorded for "Base"/);
  });

  it('never prints the absolute root or an absolute path outside it', async () => {
    const text = await call({ symbol: 'helper' });
    expect(text).not.toContain(root);
    expect(text).not.toContain('/outside');
  });

  it('rejects an unknown relation type', async () => {
    await expect(handler({ symbol: 'x', relation_type: 'uses' })).rejects.toThrow();
  });
});

describe('search_relations (detailed)', () => {
  it('returns JSON with relative paths', async () => {
    const data = JSON.parse(await call({ symbol: 'helper', response_format: 'detailed' })) as {
      symbol: string; total: number; relations: { type: string; direction: string; source: { file: string }; target?: { file: string }; confidence: number }[];
    };
    expect(data.symbol).toBe('helper');
    expect(data.total).toBe(3);
    expect(data.relations.map((r) => r.source.file)).toEqual(['src/a.ts', '…/lib/x.ts', 'src/a.ts']);
    expect(data.relations[2]).toMatchObject({ type: 'calls', direction: 'in', confidence: 0.9, target: { file: 'src/b.ts' } });
    expect(JSON.stringify(data)).not.toContain(root);
  });
});

describe('search_relations definition', () => {
  it('describes what is recorded and that it is approximate, in a few lines', () => {
    expect(description.length).toBeLessThan(700);
    expect(description).toMatch(/calls/);
    expect(description).toMatch(/imports/);
    expect(description).toMatch(/inherits/);
    expect(description).toMatch(/approximate|name-based/i);
    expect(description).not.toMatch(/does not record|no relations|empty/i);
  });

  it('documents its parameters', () => {
    const standard = (inputSchema as {
      '~standard': { jsonSchema: { input: (options: { target: string }) => { properties: Record<string, { description?: string }>; required: string[] } } };
    })['~standard'];
    const schema = standard.jsonSchema.input({ target: 'draft-2020-12' });
    expect(schema.required).toEqual(['symbol']);
    expect(Object.values(schema.properties).every((p) => (p.description ?? '').length > 0)).toBe(true);
    expect(Object.keys(schema.properties).sort()).toEqual(['direction', 'max_tokens', 'offset', 'relation_type', 'response_format', 'symbol']);
  });
});
