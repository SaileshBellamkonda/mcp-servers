import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { Embedder } from '../../../src/embedder/embedder.js';
import { PathGuard } from '../../../src/core/path-guard.js';
import { CodeParser } from '../../../src/indexer/code-parser.js';
import { registerSearch } from '../../../src/tools/search.js';

type Handler = (input: unknown) => Promise<{ content: { text: string }[] }>;

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '../../../src');
const dbFile = path.join(srcDir, 'vectordb/db.ts');
const VEC = [0.9, 0.1, 0.1, 0.1];

let parser: CodeParser;
let allDb: VectorDB;
let classOnlyDb: VectorDB;

function makeHandler(db: VectorDB): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: (name: string, _config: unknown, h: Handler): void => { if (name === 'search') handler = h; },
  } as unknown as McpServer;
  registerSearch(server, db, { embed: () => Promise.resolve(VEC) } as unknown as Embedder, 5, new PathGuard([srcDir]));
  if (!handler) throw new Error('search not registered');
  return handler;
}

let allHandler: Handler;
let classOnlyHandler: Handler;

beforeAll(() => {
  parser = new CodeParser();
  const chunks = parser.parseFile(dbFile);
  allDb = VectorDB.open(':memory:', 4);
  allDb.insertCodeDocument(dbFile, new Date(), chunks, chunks.map(() => VEC));
  const classOnly = chunks.filter((c) => c.symbolType === 'class');
  classOnlyDb = VectorDB.open(':memory:', 4);
  classOnlyDb.insertCodeDocument(dbFile, new Date(), classOnly, classOnly.map(() => VEC));
  allHandler = makeHandler(allDb);
  classOnlyHandler = makeHandler(classOnlyDb);
});

afterAll(() => {
  allDb.close();
  classOnlyDb.close();
  parser.close();
});

async function run(handler: Handler, input: Record<string, unknown>): Promise<string> {
  return (await handler({ mode: 'keyword', ...input })).content[0]?.text ?? '';
}

describe('search results for a class skeleton', () => {
  it('shows the class header line and the first members, a few lines long', async () => {
    const out = await run(classOnlyHandler, { query: 'VectorDB' });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^vectordb\/db\.ts:\d+-\d+ class VectorDB /);
    const members = lines.slice(1).filter((l) => l.startsWith('  '));
    expect(members.length).toBeLessThanOrEqual(5);
    expect(members.join('\n')).toContain('readonly db: SqliteDatabase');
    expect(members.join('\n')).toContain('method private constructor(db: SqliteDatabase)');
    expect(out).not.toContain('this.db.prepare');
  });

  it('is much shorter than the whole 22k-character class was', async () => {
    const out = await run(classOnlyHandler, { query: 'VectorDB', max_tokens: 4000 });
    expect(out.length).toBeLessThan(1000);
  });

  it('the class is left out when one of its methods matched too', async () => {
    const out = await run(allHandler, { query: 'searchHybrid' });
    expect(out).toMatch(/method VectorDB\.searchHybrid/);
    expect(out).not.toMatch(/ class VectorDB /);
  });
});
