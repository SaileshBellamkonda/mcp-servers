/**
 * Helpers of the real-repository benchmark (`bench-repo.ts`): argument parsing, the labelled-query file format, seeded
 * sampling of relation rows and the recall of hand-picked known edges. Nothing here reads a repository by itself.
 */
import type { LabelledQuery, QueryKind, Target } from './retrieval-queries.js';
import type { SqliteDatabase } from '../../src/vectordb/sqlite-db.js';

export interface RepoBenchArgs {
  repo: string;
  lang: string;
  include: string[];
  queries: string | undefined;
  db: string | undefined;
  seed: number;
  dim: number;
  sampleOut: string | undefined;
}

/** A relation checked by grep in the source: `file` is a path suffix, `symbol` the source symbol (`Class.method`, '' for imports). */
export interface KnownEdge {
  type: 'calls' | 'imports' | 'inherits';
  file: string;
  symbol: string;
  /** Callee, base type or (imports) module specifier / imported name as the extractor writes it. */
  target: string;
}

export interface RepoQueryFile {
  /** Public repository URL and the commit the labels were verified against. */
  repo: string;
  sha: string;
  /** Include globs relative to the repository root. */
  include: string[];
  queries: { query: string; kind: QueryKind; expect: Target[] }[];
  knownEdges?: KnownEdge[];
}

export function parseArgs(argv: readonly string[]): RepoBenchArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--') || arg === '--') continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), next);
    i++;
  }
  const repo = values.get('repo');
  const lang = values.get('lang');
  if (repo === undefined || lang === undefined) throw new Error('Usage: bench:repo --repo <dir> --lang <language> [--include <globs,comma>] [--queries <json>] [--db <file>] [--seed <n>] [--dim <n>] [--sample-out <json>]');
  return {
    repo,
    lang,
    include: (values.get('include') ?? '').split(',').map((g) => g.trim()).filter((g) => g !== ''),
    queries: values.get('queries'),
    db: values.get('db'),
    seed: Number(values.get('seed') ?? '1'),
    dim: Number(values.get('dim') ?? '768'),
    sampleOut: values.get('sample-out'),
  };
}

export function toLabelled(file: RepoQueryFile): LabelledQuery[] {
  return file.queries.map((q) => ({ query: q.query, kind: q.kind, expect: q.expect }));
}

/** Deterministic PRNG (mulberry32) so a sample can be reproduced from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` items of `items` chosen with a seeded Fisher-Yates shuffle (all of them, in the shuffled order, when fewer exist). */
export function sampleSeeded<T>(items: readonly T[], count: number, seed: number): T[] {
  const copy = [...items];
  const random = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, count);
}

/** A relation counts as visible to `search_relations` unless it is a weak call that nothing resolved. */
export const VISIBLE_SQL = '(cr.weak = 0 OR cr.target_chunk_id IS NOT NULL OR cr.confidence = 0.5)';

export interface SampledRelation {
  id: number;
  type: string;
  sourceFile: string;
  sourceSymbol: string;
  sourceParent: string;
  sourceStart: number;
  line: number;
  targetName: string;
  targetFile: string;
  names: string;
  confidence: number;
  resolvedTo: string;
}

export function visibleRelations(db: SqliteDatabase, type: string): SampledRelation[] {
  return db
    .prepare<{
      id: number; relation_type: string; src_file: string; src_name: string | null; src_parent: string | null; src_start: number | null;
      line: number | null; target_name: string; target_file: string | null; names: string | null; confidence: number | null;
      tgt_file: string | null; tgt_name: string | null; tgt_parent: string | null; tgt_start: number | null;
    }>(
      `SELECT cr.id, cr.relation_type, sd.filename AS src_file, sm.symbol_name AS src_name, sm.parent_symbol AS src_parent, sm.start_line AS src_start,
              cr.line, cr.target_name, cr.target_file, cr.names, cr.confidence,
              td.filename AS tgt_file, tm.symbol_name AS tgt_name, tm.parent_symbol AS tgt_parent, tm.start_line AS tgt_start
       FROM code_relations cr
       JOIN chunks sc ON sc.id = cr.source_chunk_id JOIN documents sd ON sd.id = sc.document_id
       LEFT JOIN code_metadata sm ON sm.chunk_id = sc.id
       LEFT JOIN chunks tc ON tc.id = cr.target_chunk_id LEFT JOIN documents td ON td.id = tc.document_id
       LEFT JOIN code_metadata tm ON tm.chunk_id = tc.id
       WHERE cr.relation_type = ? AND ${VISIBLE_SQL} ORDER BY cr.id`,
    )
    .all(type)
    .map((r) => ({
      id: r.id,
      type: r.relation_type,
      sourceFile: r.src_file,
      sourceSymbol: r.src_name ?? '',
      sourceParent: r.src_parent ?? '',
      sourceStart: r.src_start ?? 0,
      line: r.line ?? 0,
      targetName: r.target_name,
      targetFile: r.target_file ?? '',
      names: r.names ?? '',
      confidence: r.confidence ?? 0,
      resolvedTo: r.tgt_file === null ? '' : `${r.tgt_file}:${String(r.tgt_start ?? 0)} ${r.tgt_parent ? `${r.tgt_parent}.` : ''}${r.tgt_name ?? ''}`,
    }));
}

/** True when the index holds a visible relation matching the known edge. */
export function hasKnownEdge(db: SqliteDatabase, edge: KnownEdge): boolean {
  const parts = edge.symbol.split('.').filter((p) => p !== '');
  const name = parts.at(-1);
  const parent = parts.length > 1 ? parts.at(-2) : undefined;
  const clauses = ['cr.relation_type = ?', `${VISIBLE_SQL}`, "sd.filename LIKE '%' || ?"];
  const args: (string | number)[] = [edge.type, edge.file];
  if (edge.type === 'imports') {
    clauses.push("(cr.target_name = ? OR instr(cr.names, ',' || ? || ',') > 0)");
    args.push(edge.target, edge.target);
  } else {
    clauses.push('cr.target_name = ?');
    args.push(edge.target);
    if (name !== undefined) {
      clauses.push('sm.symbol_name = ?');
      args.push(name);
    }
    if (parent !== undefined) {
      clauses.push('sm.parent_symbol = ?');
      args.push(parent);
    }
  }
  const row = db
    .prepare<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM code_relations cr
       JOIN chunks sc ON sc.id = cr.source_chunk_id JOIN documents sd ON sd.id = sc.document_id
       LEFT JOIN code_metadata sm ON sm.chunk_id = sc.id WHERE ${clauses.join(' AND ')}`,
    )
    .get(...args);
  return (row?.cnt ?? 0) > 0;
}
