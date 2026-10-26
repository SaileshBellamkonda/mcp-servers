import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import type { CodeChunk } from '../../../src/core/types.js';
import { registerSearchRelations } from '../../../src/tools/search-relations.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const root = path.resolve('/work/project');
const chunk = (name: string): CodeChunk => ({
  content: `function ${name}() {}`, position: 0, symbolName: name, symbolType: 'function', language: 'typescript',
  startLine: 1, endLine: 1, parentSymbol: '', signature: `function ${name}()`,
});

let db: VectorDB;
let handler: Handler;
let description = '';

beforeEach(() => {
  db = VectorDB.open(':memory:', 4);
  db.insertCodeDocument(path.join(root, 'src', 'caller.ts'), new Date(), [chunk('caller')], [[0.1, 0.2, 0.3, 0.4]]);
  const sourceChunk = db.getChunkIdBySymbol(path.join(root, 'src', 'caller.ts'), 'caller') ?? 0;
  db.insertRelations([
    { sourceChunkId: sourceChunk, relationType: 'calls', targetName: 'callee', targetFile: path.join(root, 'src', 'callee.ts'), confidence: 1 },
    { sourceChunkId: sourceChunk, relationType: 'imports', targetName: 'elsewhere', targetFile: path.resolve('/outside/lib/elsewhere.ts'), confidence: 1 },
  ]);
  const server = {
    registerTool: (_name: string, config: { description: string }, h: Handler): void => { handler = h; description = config.description; },
  } as unknown as McpServer;
  registerSearchRelations(server, db, new PathGuard([root]));
});

afterEach(() => { db.close(); });

interface Relation { sourceFile?: string; targetFile: string; targetName: string }

describe('search_relations', () => {
  it('returns paths relative to the allowed root, never absolute', async () => {
    const response = await handler({ symbol: 'caller', direction: 'outgoing' });
    const data = JSON.parse(response.content[0]?.text ?? '{}') as { relations: Relation[]; count: number };
    expect(data.count).toBe(2);
    const byName = new Map(data.relations.map((r) => [r.targetName, r]));
    expect(byName.get('callee')?.targetFile).toBe('src/callee.ts');
    expect(byName.get('callee')?.sourceFile).toBe('src/caller.ts');
    expect(byName.get('elsewhere')?.targetFile).toBe('…/lib/elsewhere.ts');
    expect(response.content[0]?.text).not.toContain(root);
    expect(response.content[0]?.text).not.toContain('/outside');
  });

  it('says in its description that the indexer records no relations yet', () => {
    expect(description).toMatch(/not record|no relations|empty/i);
  });
});
