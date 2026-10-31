import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { runStartupSync } from '../../../src/indexer/sync.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { FileRefresher } from '../../../src/indexer/refresher.ts';
import { CODE_PARSER_VERSION } from '../../../src/indexer/code-parser.ts';
import { RELATIONS_VERSION } from '../../../src/indexer/relations.ts';
import { VectorDB, type RelationHit } from '../../../src/vectordb/db.ts';
import { openSqliteDatabase } from '../../../src/vectordb/sqlite-db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import { SyncManager } from '../../../src/indexer/sync-manager.ts';
import type { McpLogger } from '@mcp-servers/common';
import type { McpServer } from '@modelcontextprotocol/server';
import { PathGuard } from '../../../src/core/path-guard.ts';
import { registerDeleteDocument } from '../../../src/tools/delete-document.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-relations-index-test');
const DIM = 4;

const logger = {
  debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn(), log: vi.fn(),
} as unknown as McpLogger;

let fetchCalls = 0;
/** Embeds a text as four numbers derived from it, so chunks have different vectors. */
function makeEmbedder(): Embedder {
  fetchCalls = 0;
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    fetchCalls++;
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.input.map((text, i) => ({ index: i, embedding: [text.length % 7, text.length % 5, text.charCodeAt(0) % 3, 1] })),
      }),
    } as Response;
  });
  return new Embedder({ url: 'http://x', model: 'test', batchSize: 100 }, mockFetch);
}

const file = (name: string): string => path.join(tmpDir, name);
const A = "import { beta } from './b.js';\nexport function alpha(): number { return beta() + 1; }\n";
const B = 'export function beta(): number { return 2; }\nexport class Base {}\n';
const C = "import { Base } from './b';\nexport class Kid extends Base { run() { return alpha(); } }\n";

let db: VectorDB;
let indexer: Indexer;
let globs: { docsInclude: string[]; docsExclude: string[]; codeInclude: string[]; codeExclude: string[] };
let codeMatcher: GlobMatcher;

function open(dbPath: string): void {
  db = VectorDB.open(dbPath, DIM);
  indexer = new Indexer(db, makeEmbedder(), 500, { codeMatcher });
}

function startup(): Promise<void> {
  return runStartupSync(db, indexer, new SyncManager(), { globs, useGitignore: false }, tmpDir, logger);
}

const query = (symbol: string, direction: 'in' | 'out' | 'both' = 'both', types?: ('calls' | 'imports' | 'inherits')[]): RelationHit[] =>
  db.queryRelations({ symbol, direction, types, limit: 100, offset: 0 }).hits;
const importsOf = (symbol: string): (string | number)[][] =>
  query(symbol, 'in', ['imports']).map((h) => [path.basename(h.source.file), path.basename(h.targetFile), h.confidence]);
const summary = (hits: RelationHit[]): string[] => hits.map((h) => `${h.direction} ${h.type} ${h.source.name || path.basename(h.source.file)}->${h.target?.name ?? h.targetName} ${h.confidence}`);

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(file('a.ts'), A);
  writeFileSync(file('b.ts'), B);
  writeFileSync(file('c.ts'), C);
  const fwd = tmpDir.replace(/\\/g, '/');
  globs = { docsInclude: [], docsExclude: [], codeInclude: [`${fwd}/**/*.ts`], codeExclude: [] };
  codeMatcher = new GlobMatcher(globs.codeInclude, [], tmpDir);
  open(':memory:');
});

afterEach(() => {
  indexer.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('relations recorded while indexing', () => {
  it('resolves edges across files whatever the order the files were indexed in, without a pass left to do', async () => {
    await indexer.scanCode();
    expect(await db.resolvePendingRelations()).toBe(0);
    expect(summary(query('beta', 'in', ['calls']))).toEqual(['in calls alpha->beta 0.9']);
    expect(importsOf('beta')).toEqual([['a.ts', 'b.ts', 1]]);
    expect(summary(query('Base', 'in', ['inherits']))).toEqual(['in inherits Kid->Base 0.9']);
    expect(summary(query('alpha', 'in'))).toEqual(['in calls run->alpha 0.9']);
    expect(query('b.ts', 'in').map((h) => path.basename(h.source.file)).sort()).toEqual(['a.ts', 'c.ts']);
  });

  it('rebuilds the relations of a file together with its chunks when it changes', async () => {
    await indexer.scanCode();
    writeFileSync(file('a.ts'), "import { Base } from './b';\nexport function alpha(): number { return other(); }\n");
    utimesSync(file('a.ts'), new Date(), new Date(Date.now() + 5000));
    await indexer.scanCode();
    expect(summary(query('alpha', 'out'))).toEqual(['out calls alpha->other 0.3']);
    expect(query('beta', 'in')).toEqual([]);
    expect(db.queryRelations({ symbol: 'a.ts', direction: 'out', limit: 10, offset: 0 }).hits.map((h) => h.names)).toEqual([['Base']]);
  });

  it('removes the relations of a deleted file and unresolves the edges that pointed into it', async () => {
    await indexer.scanCode();
    unlinkSync(file('b.ts'));
    const refresher = new FileRefresher(db, indexer, new GlobMatcher([], [], tmpDir), codeMatcher, logger);
    expect(await refresher.refresh(file('b.ts'))).toBe(true);
    expect(await db.resolvePendingRelations()).toBe(0);
    expect(db.getChunkIdBySymbol(file('b.ts'), 'beta')).toBeNull();
    expect(summary(query('beta', 'in', ['calls']))).toEqual(['in calls alpha->beta 0.3']);
    expect(importsOf('beta')).toEqual([['a.ts', '', 0.3]]);
    expect(summary(query('Base', 'in', ['inherits']))).toEqual(['in inherits Kid->Base 0.3']);
  });

  it('re-resolves the edges of other files when a file is re-indexed by the refresher', async () => {
    await indexer.scanCode();
    writeFileSync(file('b.ts'), 'export function beta(): number { return 3; }\nexport function beta2(): number { return 4; }\n');
    utimesSync(file('b.ts'), new Date(), new Date(Date.now() + 5000));
    const refresher = new FileRefresher(db, indexer, new GlobMatcher([], [], tmpDir), codeMatcher, logger);
    await refresher.refresh(file('b.ts'));
    expect(await db.resolvePendingRelations()).toBe(0);
    expect(summary(query('beta', 'in', ['calls']))).toEqual(['in calls alpha->beta 0.9']);
    expect(importsOf('beta')).toEqual([['a.ts', 'b.ts', 1]]);
    expect(summary(query('Base', 'in', ['inherits']))).toEqual(['in inherits Kid->Base 0.3']);
  });
});

describe('delete_document', () => {
  it('leaves no unresolved work behind: edges that pointed into the deleted file are already updated', async () => {
    await indexer.scanCode();
    let handler: (input: unknown) => Promise<unknown> = () => Promise.resolve(undefined);
    const server = { registerTool: (_name: string, _config: unknown, h: typeof handler): void => { handler = h; } } as unknown as McpServer;
    registerDeleteDocument(server, db, new SyncManager(), new PathGuard([tmpDir]));
    await handler({ filename: file('b.ts') });
    expect(await db.resolvePendingRelations()).toBe(0);
    expect(summary(query('beta', 'in', ['calls']))).toEqual(['in calls alpha->beta 0.3']);
  });
});

describe('relations version and backfill', () => {
  const dbPath = (name: string): string => file(`${name}.db`);

  /** An index as the previous version wrote it: chunks and vectors, no relations, no relations_version. */
  async function legacyCopy(): Promise<string> {
    const original = dbPath('original');
    indexer.close();
    db.close();
    open(original);
    await startup();
    expect(db.getRelationsVersion()).toBe(RELATIONS_VERSION);
    indexer.close();
    db.close();
    const copy = dbPath('legacy');
    copyFileSync(original, copy);
    const raw = openSqliteDatabase(copy);
    raw.exec("DELETE FROM code_relations; DELETE FROM relation_caps; DELETE FROM relation_dirty; DELETE FROM db_meta WHERE key = 'relations_version'");
    raw.close();
    return copy;
  }

  const snapshot = (): { ids: (number | null)[]; hits: (string | number)[][] } => ({
    ids: ['alpha', 'beta', 'Base', 'Kid', 'run'].map((n) => ['a.ts', 'b.ts', 'c.ts'].map((f) => db.getChunkIdBySymbol(file(f), n)).find((id) => id !== null) ?? null),
    hits: db.searchWithFilter([1, 2, 1, 1], 50, null).map((h) => [h.document, h.position, h.similarity]),
  });

  it('records the version on the first startup of an index', async () => {
    expect(db.getRelationsVersion()).toBeNull();
    await startup();
    expect(db.getRelationsVersion()).toBe(RELATIONS_VERSION);
    expect(db.getRelationCount()).toBeGreaterThan(0);
  });

  it('fills relations of an existing index at startup without re-embedding or touching chunks and vectors', async () => {
    const copy = await legacyCopy();
    open(copy);
    expect(db.getRelationCount()).toBe(0);
    const before = snapshot();
    expect(before.ids.every((id) => id !== null)).toBe(true);

    await startup();

    expect(fetchCalls).toBe(0);
    expect(db.getRelationsVersion()).toBe(RELATIONS_VERSION);
    expect(db.getCodeParserVersion()).toBe(CODE_PARSER_VERSION);
    expect(snapshot()).toEqual(before);
    expect(summary(query('beta', 'in', ['calls']))).toEqual(['in calls alpha->beta 0.9']);
    expect(importsOf('beta')).toEqual([['a.ts', 'b.ts', 1]]);
    expect(summary(query('Base', 'in', ['inherits']))).toEqual(['in inherits Kid->Base 0.9']);
  });

  it('does not fill again when the version is current', async () => {
    await startup();
    const backfill = vi.spyOn(indexer, 'backfillRelations');
    await startup();
    expect(backfill).not.toHaveBeenCalled();
  });

  it('fills again when the stored version is older', async () => {
    await startup();
    db.setRelationsVersion(RELATIONS_VERSION - 1);
    const backfill = vi.spyOn(indexer, 'backfillRelations');
    await startup();
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(db.getRelationsVersion()).toBe(RELATIONS_VERSION);
  });

  it('leaves a file that changed since it was indexed to the normal scan, which re-embeds only that file', async () => {
    const copy = await legacyCopy();
    writeFileSync(file('a.ts'), "import { Base } from './b';\nexport function alpha(): number { return fresh(); }\n");
    utimesSync(file('a.ts'), new Date(), new Date(Date.now() + 5000));
    open(copy);
    await startup();
    expect(fetchCalls).toBe(1);
    expect(summary(query('alpha', 'out'))).toEqual(['out calls alpha->fresh 0.3']);
    expect(summary(query('Base', 'in', ['inherits']))).toEqual(['in inherits Kid->Base 0.9']);
    expect(db.getRelationsVersion()).toBe(RELATIONS_VERSION);
  });

  it('keeps the version unset when a file cannot be filled so the next start tries again', async () => {
    const copy = await legacyCopy();
    open(copy);
    vi.spyOn(indexer, 'backfillRelations').mockResolvedValue({ filled: 2, skipped: 0, failed: 1 });
    await startup();
    expect(db.getRelationsVersion()).toBeNull();
  });

  it('hands control back to the event loop while filling', async () => {
    for (let i = 0; i < 12; i++) writeFileSync(file(`f${String(i)}.ts`), `export function fn${String(i)}() { return 1; }\n`);
    const copy = await legacyCopy();
    open(copy);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    await indexer.backfillRelations();
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(1);
  });
});
