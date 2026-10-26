import path from 'node:path';
import { RELATIONS_ADDED_COLUMNS, RELATIONS_AUX_DDL, RELATIONS_TABLE_DDL } from './schema.js';
import type { SqlParam, SqliteDatabase } from './sqlite-db.js';
import { CodeFileIndex } from '../indexer/module-resolver.js';
import type { ExtractedRelations, RelationKind } from '../indexer/relations.js';
import { isSupportedExtension } from '../indexer/languages.js';

/** Confidence of a relation, by how its target was found. */
export const CONFIDENCE = { importResolved: 1, unique: 0.9, ambiguous: 0.5, unresolved: 0.3 } as const;

/** Symbol kinds an edge of each type may point to. */
const TARGET_TYPES: Record<'calls' | 'inherits', ReadonlySet<string>> = {
  calls: new Set(['function', 'method', 'class', 'struct']),
  inherits: new Set(['class', 'struct', 'interface']),
};

const MAX_NAMES_PER_IMPORT = 60;
const MAX_CANDIDATE_CHUNKS = 500;
const DIRTY_BATCH = 100;

export interface RelationQuery {
  /** A symbol name, `Class.method`, or a file path / file name. */
  symbol: string;
  types?: readonly RelationKind[] | undefined;
  direction: 'in' | 'out' | 'both';
  limit: number;
  offset: number;
}

export interface RelationEndpoint {
  file: string;
  name: string;
  parent: string;
  startLine: number;
}

export interface RelationHit {
  direction: 'in' | 'out';
  type: RelationKind;
  confidence: number;
  /** Line of the call, base type or import in the source file (the source symbol's first line for older rows). */
  line: number;
  /** The chunk the relation was found in (for imports: the first chunk of the file). */
  source: RelationEndpoint;
  /** Callee or base type as written; for imports the module specifier. */
  targetName: string;
  /** Imports: the file the module resolves to, or '' when it is not indexed. */
  targetFile: string;
  names: string[];
  /** The symbol the edge was resolved to, when exactly one matched. */
  target?: RelationEndpoint | undefined;
}

export interface RelationPage {
  hits: RelationHit[];
  /** Matching relations before paging. */
  total: number;
  /** Indexed symbols (or files) the query matched. */
  symbols: number;
  /** Relations of the matched symbols that were not recorded because of the per-chunk cap. */
  omitted: { type: RelationKind; count: number }[];
}

export interface ResolveOptions {
  /** Called between batches so a long pass hands control back to the event loop. */
  yieldToEventLoop?: (() => Promise<void>) | undefined;
}

interface EdgeRow {
  id: number;
  source_chunk_id: number;
  relation_type: 'calls' | 'inherits';
  target_name: string;
  target_chunk_id: number | null;
  confidence: number;
  doc_id: number;
  weak: number;
  qualifier: string | null;
}

/** Line range of a function or method chunk of one document. */
interface FunctionRange {
  chunk_id: number;
  start_line: number;
  end_line: number;
}

interface Candidate {
  chunk_id: number;
  document_id: number;
  filename: string;
  symbol_type: string;
  symbol_name: string;
  parent_symbol: string | null;
  start_line: number | null;
  end_line: number | null;
}

interface ImportRow {
  id: number;
  target_name: string;
  names: string | null;
  target_file: string | null;
  confidence: number | null;
  src_file: string;
  language: string | null;
}

interface QueryRow {
  id: number;
  dir: 'in' | 'out';
  relation_type: RelationKind;
  line: number | null;
  target_name: string;
  target_file: string | null;
  confidence: number | null;
  names: string | null;
  src_file: string;
  src_name: string | null;
  src_parent: string | null;
  src_start: number | null;
  tgt_file: string | null;
  tgt_name: string | null;
  tgt_parent: string | null;
  tgt_start: number | null;
}

/**
 * The files the imports of one document (`?`) resolve to, with the names each import brings in. CROSS JOIN fixes the order: SQLite would otherwise start from
 * every `imports` row of the index (idx_rel_type) and look the chunk of each one up, which made resolving the calls of an
 * index quadratic (30 s of a 65 s run over 1,500 files); starting from the chunks of the document it takes 0.03 ms.
 */
export const IMPORTED_FILES_SQL = `SELECT DISTINCT cr.target_file, cr.names FROM chunks c CROSS JOIN code_relations cr ON cr.source_chunk_id = c.id
  WHERE c.document_id = ? AND cr.relation_type = 'imports' AND cr.target_file != ''`;

/** Imports (`?` 1: highest relation id to consider, 2: LIKE pattern) of modules that no indexed file satisfied so far. */
export const UNRESOLVED_IMPORTS_BY_STEM_SQL = `SELECT cr.id, cr.target_name, cr.names, cr.target_file, cr.confidence, d.filename AS src_file, cm.language
  FROM code_relations cr JOIN chunks c ON c.id = cr.source_chunk_id JOIN documents d ON d.id = c.document_id
  LEFT JOIN code_metadata cm ON cm.chunk_id = c.id
  WHERE cr.relation_type = 'imports' AND cr.target_file = '' AND cr.id <= ? AND cr.target_name LIKE ? ESCAPE '!'`;

/**
 * Candidates that are one symbol to a reader: the overloads of a method in one class, a struct and its `impl` blocks,
 * and a class together with its constructors (which are indexed under the class name). Each group keeps its first
 * chunk, so a name that only has several such chunks resolves instead of staying ambiguous.
 */
function collapseSymbols(candidates: readonly Candidate[]): Candidate[] {
  const first = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${String(c.document_id)}\u0000${c.parent_symbol ?? ''}\u0000${c.symbol_type}`;
    const known = first.get(key);
    if (!known || (c.start_line ?? 0) < (known.start_line ?? 0)) first.set(key, c);
  }
  const grouped = [...first.values()];
  const classLike = new Set(grouped.filter((c) => c.symbol_type === 'class' || c.symbol_type === 'struct').map((c) => `${String(c.document_id)}\u0000${c.symbol_name}`));
  return grouped.filter((c) => !(c.symbol_type === 'function' && c.parent_symbol === c.symbol_name && classLike.has(`${String(c.document_id)}\u0000${c.symbol_name}`)));
}

function isInFiles(candidate: Candidate, files: readonly string[]): boolean {
  const file = candidate.filename.replaceAll('\\', '/');
  return files.includes(file) || files.includes(dirname(file));
}

interface ImportedFiles {
  files: string[];
  /** Per imported file (or directory): the names brought in, or null for everything. */
  names: Map<string, Set<string> | null>;
}

/** True when an import of the calling document brings in the candidate itself, its class, or everything of its file. */
function isBroughtIn(candidate: Candidate, imported: ImportedFiles): boolean {
  const file = candidate.filename.replaceAll('\\', '/');
  for (const where of [file, dirname(file)]) {
    if (!imported.names.has(where)) continue;
    const names = imported.names.get(where);
    if (names === null || names === undefined || names.has('*') || names.has(candidate.symbol_name) || (candidate.parent_symbol !== null && names.has(candidate.parent_symbol))) return true;
  }
  return false;
}

/** True when the symbol is a member of class/type `name`, or lives in a file or folder of that name (a module or package). */
function belongsTo(candidate: Candidate, name: string): boolean {
  if (candidate.parent_symbol === name) return true;
  const file = candidate.filename.replaceAll('\\', '/');
  const base = path.posix.basename(file);
  return base.slice(0, base.length - path.posix.extname(base).length) === name || path.posix.basename(path.posix.dirname(file)) === name;
}

/**
 * True when `candidate` is nested in a function or method of its file (a closure, a helper of a test, a local class)
 * and the calling chunk is outside that function, in another file or elsewhere in the same one.
 */
function isHiddenLocal(
  candidate: Candidate,
  sourceDocument: number,
  source: { start: number; end: number } | null,
  functionsOf: (document: number) => readonly FunctionRange[],
): boolean {
  if (candidate.start_line === null || candidate.end_line === null) return false;
  let innermost: FunctionRange | undefined;
  for (const f of functionsOf(candidate.document_id)) {
    if (f.chunk_id === candidate.chunk_id || f.start_line > candidate.start_line || f.end_line < candidate.end_line) continue;
    if (f.start_line === candidate.start_line && f.end_line === candidate.end_line) continue;
    if (!innermost || f.end_line - f.start_line < innermost.end_line - innermost.start_line) innermost = f;
  }
  if (!innermost) return false;
  return candidate.document_id !== sourceDocument || source === null || source.start < innermost.start_line || source.end > innermost.end_line;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

function likeEscape(text: string): string {
  return text.replace(/[!%_]/g, (c) => `!${c}`);
}

function toNamesColumn(names: readonly string[] | undefined): string | null {
  const list = (names ?? []).filter((n) => n !== '' && !n.includes(',')).slice(0, MAX_NAMES_PER_IMPORT);
  return list.length === 0 ? null : `,${list.join(',')},`;
}

function fromNamesColumn(raw: string | null): string[] {
  return raw === null ? [] : raw.split(',').filter((n) => n !== '');
}

function dirname(file: string): string {
  return path.posix.dirname(file.replaceAll('\\', '/'));
}

/** Creates the relation tables and indexes of databases written before relations were recorded. */
export function ensureRelationsSchema(db: SqliteDatabase): void {
  db.exec(RELATIONS_TABLE_DDL);
  const columns = new Set(db.prepare<{ name: string }>('SELECT name FROM pragma_table_info(?)').all('code_relations').map((c) => c.name));
  for (const column of RELATIONS_ADDED_COLUMNS) if (!columns.has(column.name)) db.exec(column.ddl);
  db.exec(RELATIONS_AUX_DDL);
}

/**
 * Stores, resolves and queries the relations between code symbols.
 *
 * Edges are written with their file's chunks; the ones the file itself can resolve are resolved at once. A change to
 * the symbols of one file (new, replaced or deleted) can alter the resolution of edges in other files, so the changed
 * names go to `relation_dirty` and `resolvePending` visits only the edges that name them.
 */
export class RelationStore {
  private readonly db: SqliteDatabase;
  private files: CodeFileIndex | null = null;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  // ─── Indexed code files (for resolving imports) ──────────────────────────────

  private fileIndex(): CodeFileIndex {
    this.files ??= new CodeFileIndex(this.db.prepare<{ filename: string }>("SELECT filename FROM documents WHERE doc_type = 'code'").all().map((r) => r.filename));
    return this.files;
  }

  noteFileAdded(filename: string): void {
    this.files?.add(filename);
  }

  noteFileRemoved(filename: string): void {
    this.files?.remove(filename);
  }

  /** Forget the cached file list, e.g. after a rolled-back transaction. */
  invalidate(): void {
    this.files = null;
  }

  // ─── Writing ─────────────────────────────────────────────────────────────────

  count(): number {
    return this.db.prepare<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM code_relations').get()?.cnt ?? 0;
  }

  private maxRelationId(): number {
    return this.db.prepare<{ id: number | null }>('SELECT MAX(id) AS id FROM code_relations').get()?.id ?? 0;
  }

  /** Symbol names of one stored document. */
  symbolNamesOf(docId: number): string[] {
    return this.db
      .prepare<{ symbol_name: string }>('SELECT DISTINCT cm.symbol_name FROM code_metadata cm JOIN chunks c ON c.id = cm.chunk_id WHERE c.document_id = ? AND cm.symbol_name IS NOT NULL')
      .all(docId)
      .map((r) => r.symbol_name);
  }

  /**
   * Records that the symbols named `names` changed, or (`stems`) that a file was added under these module names, or
   * (`gone`) that a file was removed. Edges that exist now are visited by the next `resolvePending`.
   */
  markDirty(change: { names?: Iterable<string>; stems?: Iterable<string>; gone?: Iterable<string> }): void {
    const watermark = this.maxRelationId();
    const stmt = this.db.prepare(
      'INSERT INTO relation_dirty (kind, value, watermark) VALUES (?, ?, ?) ON CONFLICT(kind, value) DO UPDATE SET watermark = MAX(watermark, excluded.watermark)',
    );
    for (const name of change.names ?? []) stmt.run('name', name, watermark);
    for (const stem of change.stems ?? []) stmt.run('stem', stem, watermark);
    for (const gone of change.gone ?? []) stmt.run('gone', gone, watermark);
  }

  /**
   * Replaces the relations of the chunks of one document. `chunkIds[position]` is the id of the chunk stored at that
   * position. Edges are resolved against what is indexed now.
   */
  replaceForChunks(filename: string, language: string, chunkIds: readonly number[], extracted: ExtractedRelations | undefined): void {
    const known = chunkIds.filter((id) => id > 0);
    if (known.length > 0) {
      const marks = placeholders(known.length);
      this.db.prepare(`DELETE FROM code_relations WHERE source_chunk_id IN (${marks})`).run(...known);
      this.db.prepare(`DELETE FROM relation_caps WHERE source_chunk_id IN (${marks})`).run(...known);
    }
    if (!extracted) return;

    const insert = this.db.prepare(
      'INSERT INTO code_relations (source_chunk_id, target_chunk_id, relation_type, target_name, target_file, confidence, line, names, weak, qualifier) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const edges: EdgeRow[] = [];
    for (const relation of extracted.relations) {
      const source = chunkIds[relation.sourcePosition];
      if (source === undefined || source <= 0) continue;
      if (relation.type === 'imports') {
        const file = this.fileIndex().resolveImport(language, relation.targetName, relation.names ?? [], filename);
        insert.run(source, 'imports', relation.targetName, file ?? '', file === null ? CONFIDENCE.unresolved : CONFIDENCE.importResolved, relation.line, toNamesColumn(relation.names), 0, null);
      } else {
        const weak = relation.weak === true ? 1 : 0;
        const qualifier = relation.qualifier ?? null;
        const result = insert.run(source, relation.type, relation.targetName, '', CONFIDENCE.unresolved, relation.line, null, weak, qualifier);
        edges.push({ id: result.lastInsertRowid, source_chunk_id: source, relation_type: relation.type, target_name: relation.targetName, target_chunk_id: null, confidence: CONFIDENCE.unresolved, doc_id: 0, weak, qualifier });
      }
    }
    if (edges.length > 0) this.resolveEdges(edges, this.docIdOf(filename));

    const cap = this.db.prepare('INSERT OR REPLACE INTO relation_caps (source_chunk_id, relation_type, dropped) VALUES (?, ?, ?)');
    for (const truncated of extracted.truncated) {
      const source = chunkIds[truncated.sourcePosition];
      if (source !== undefined && source > 0 && truncated.dropped > 0) cap.run(source, truncated.type, truncated.dropped);
    }
  }

  private docIdOf(filename: string): number {
    return this.db.prepare<{ id: number }>('SELECT id FROM documents WHERE filename = ?').get(filename)?.id ?? 0;
  }

  // ─── Resolution ──────────────────────────────────────────────────────────────

  /** Resolves a batch of calls/inherits edges of one document (`docId` 0: read each edge's own document). */
  private resolveEdges(edges: readonly EdgeRow[], docId: number): number {
    const candidates = new Map<string, Candidate[]>();
    const imported = new Map<number, ImportedFiles>();
    const update = this.db.prepare('UPDATE code_relations SET target_chunk_id = ?, confidence = ? WHERE id = ?');
    let changed = 0;

    const candidatesFor = (name: string): Candidate[] => {
      let found = candidates.get(name);
      if (!found) {
        found = this.db
          .prepare<Candidate>(
            `SELECT cm.chunk_id, c.document_id, d.filename, cm.symbol_type, cm.symbol_name, cm.parent_symbol, cm.start_line, cm.end_line FROM code_metadata cm
             JOIN chunks c ON c.id = cm.chunk_id JOIN documents d ON d.id = c.document_id WHERE cm.symbol_name = ? LIMIT ${String(MAX_CANDIDATE_CHUNKS)}`,
          )
          .all(name);
        candidates.set(name, found);
      }
      return found;
    };
    const importedOf = (document: number): ImportedFiles => {
      let found = imported.get(document);
      if (!found) {
        found = { files: [], names: new Map() };
        for (const row of this.db.prepare<{ target_file: string; names: string | null }>(IMPORTED_FILES_SQL).all(document)) {
          const file = row.target_file.replaceAll('\\', '/');
          const names = fromNamesColumn(row.names);
          if (!found.names.has(file)) found.files.push(file);
          const known = found.names.get(file);
          // An import without names (`import a.b.C`, `import os`) brings the whole module in.
          found.names.set(file, names.length === 0 || known === null ? null : new Set([...(known ?? []), ...names]));
        }
        imported.set(document, found);
      }
      return found;
    };
    const functions = new Map<number, FunctionRange[]>();
    const functionsOf = (document: number): FunctionRange[] => {
      let found = functions.get(document);
      if (!found) {
        found = this.db
          .prepare<FunctionRange>(
            `SELECT cm.chunk_id, cm.start_line, cm.end_line FROM code_metadata cm JOIN chunks c ON c.id = cm.chunk_id
             WHERE c.document_id = ? AND cm.symbol_type IN ('function', 'method') AND cm.start_line IS NOT NULL AND cm.end_line IS NOT NULL`,
          )
          .all(document);
        functions.set(document, found);
      }
      return found;
    };
    const sources = new Map<number, { name: string; start: number; end: number } | null>();
    const sourceOf = (chunk: number): { name: string; start: number; end: number } | null => {
      let found = sources.get(chunk);
      if (found === undefined) {
        const row = this.db.prepare<{ symbol_name: string | null; start_line: number | null; end_line: number | null }>('SELECT symbol_name, start_line, end_line FROM code_metadata WHERE chunk_id = ?').get(chunk);
        found = row ? { name: row.symbol_name ?? '', start: row.start_line ?? 0, end: row.end_line ?? 0 } : null;
        sources.set(chunk, found);
      }
      return found;
    };

    for (const edge of edges) {
      const document = docId > 0 ? docId : edge.doc_id;
      const source = sourceOf(edge.source_chunk_id);
      let found = candidatesFor(edge.target_name).filter((c) => TARGET_TYPES[edge.relation_type].has(c.symbol_type));
      // A class never inherits from itself, nor from a same-named type of its own file (`impl Error for Error`);
      // `class Config(lib.Config)` names another class that happens to share the name.
      if (edge.relation_type === 'inherits') found = found.filter((c) => c.chunk_id !== edge.source_chunk_id && !(c.document_id === document && source !== null && c.symbol_name === source.name));
      // A call to a very common name (`toString`, `clone`, `contains`) is almost always a library call: it only
      // resolves to a symbol of its own file or of a file it imports.
      if (edge.weak === 1) {
        const brought = importedOf(document);
        found = found.filter((c) => c.document_id === document || isBroughtIn(c, brought));
      }
      // `GsonTypes.getRawType(x)`, `flask.views.View`: a candidate that belongs to the named class or module wins.
      if (edge.qualifier !== null && edge.qualifier !== '') {
        const named = found.filter((c) => belongsTo(c, edge.qualifier ?? ''));
        if (named.length > 0) found = named;
      }
      // A function nested in another function is only visible inside it.
      const all = collapseSymbols(found.filter((c) => !isHiddenLocal(c, document, source, functionsOf)));
      let resolved: { chunk: number | null; confidence: number };
      if (all.length === 0) {
        resolved = { chunk: null, confidence: CONFIDENCE.unresolved };
      } else {
        const sameFile = all.filter((c) => c.document_id === document);
        let pick: Candidate[] = sameFile.length > 0 ? sameFile : all;
        if (pick.length > 1 && sameFile.length === 0) {
          const files = importedOf(document).files;
          const viaImport = pick.filter((c) => isInFiles(c, files));
          if (viaImport.length > 0) pick = viaImport;
        }
        const only = pick.length === 1 ? pick[0] : undefined;
        resolved = only ? { chunk: only.chunk_id, confidence: CONFIDENCE.unique } : { chunk: null, confidence: CONFIDENCE.ambiguous };
      }
      if (resolved.chunk !== edge.target_chunk_id || resolved.confidence !== edge.confidence) {
        update.run(resolved.chunk, resolved.confidence, edge.id);
        changed++;
      }
    }
    return changed;
  }

  private resolveImportRows(rows: readonly ImportRow[]): number {
    const update = this.db.prepare('UPDATE code_relations SET target_file = ?, confidence = ? WHERE id = ?');
    let changed = 0;
    for (const row of rows) {
      const file = this.fileIndex().resolveImport(row.language ?? '', row.target_name, fromNamesColumn(row.names), row.src_file);
      const confidence = file === null ? CONFIDENCE.unresolved : CONFIDENCE.importResolved;
      if ((file ?? '') !== (row.target_file ?? '') || confidence !== row.confidence) {
        update.run(file ?? '', confidence, row.id);
        changed++;
      }
    }
    return changed;
  }

  private hasPending(): boolean {
    return (this.db.prepare<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM relation_dirty').get()?.cnt ?? 0) > 0;
  }

  /** Synchronous variant of `resolvePending`, used before a query so it never reads stale resolutions. */
  resolvePendingNow(): number {
    let changed = 0;
    while (this.hasPending()) changed += this.resolveNextBatch();
    return changed;
  }

  /** Re-resolves the edges affected by changed symbols; yields between batches. Returns how many edges changed. */
  async resolvePending(options: ResolveOptions = {}): Promise<number> {
    let changed = 0;
    while (this.hasPending()) {
      changed += this.resolveNextBatch();
      if (options.yieldToEventLoop) await options.yieldToEventLoop();
    }
    return changed;
  }

  private resolveNextBatch(): number {
    return this.db.transaction((): number => {
      // File changes first: edges of the names below use the imports resolved here.
      const files = this.db.prepare<{ kind: 'stem' | 'gone'; value: string; watermark: number }>("SELECT kind, value, watermark FROM relation_dirty WHERE kind IN ('stem','gone') LIMIT ?").all(DIRTY_BATCH);
      if (files.length > 0) {
        const changed = this.resolveFileChanges(files);
        const del = this.db.prepare('DELETE FROM relation_dirty WHERE kind = ? AND value = ?');
        for (const f of files) del.run(f.kind, f.value);
        return changed;
      }
      const names = this.db.prepare<{ value: string }>("SELECT value FROM relation_dirty WHERE kind = 'name' LIMIT ?").all(DIRTY_BATCH).map((r) => r.value);
      if (names.length === 0) return 0;
      const edges = this.db
        .prepare<EdgeRow>(
          `SELECT cr.id, cr.source_chunk_id, cr.relation_type, cr.target_name, cr.target_chunk_id, cr.confidence, c.document_id AS doc_id, cr.weak, cr.qualifier
           FROM relation_dirty rd
           JOIN code_relations cr ON cr.target_name = rd.value AND cr.id <= rd.watermark AND cr.relation_type IN ('calls','inherits')
           JOIN chunks c ON c.id = cr.source_chunk_id
           WHERE rd.kind = 'name' AND rd.value IN (${placeholders(names.length)})`,
        )
        .all(...names);
      // Group by document so imported-file lookups are shared.
      const changed = this.resolveEdges(edges, 0);
      const del = this.db.prepare("DELETE FROM relation_dirty WHERE kind = 'name' AND value = ?");
      for (const name of names) del.run(name);
      return changed;
    })();
  }

  private resolveFileChanges(changes: readonly { kind: 'stem' | 'gone'; value: string; watermark: number }[]): number {
    const select = (where: string): string => `SELECT cr.id, cr.target_name, cr.names, cr.target_file, cr.confidence, d.filename AS src_file, cm.language
      FROM code_relations cr JOIN chunks c ON c.id = cr.source_chunk_id JOIN documents d ON d.id = c.document_id
      LEFT JOIN code_metadata cm ON cm.chunk_id = c.id
      WHERE cr.relation_type = 'imports' AND ${where}`;
    const seen = new Set<number>();
    let changed = 0;
    for (const change of changes) {
      const rows =
        change.kind === 'stem'
          ? this.db.prepare<ImportRow>(UNRESOLVED_IMPORTS_BY_STEM_SQL).all(change.watermark, `%${likeEscape(change.value)}%`)
          : this.db.prepare<ImportRow>(select('(cr.target_file = ? OR cr.target_file = ?)')).all(change.value, dirname(change.value));
      changed += this.resolveImportRows(rows.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }));
    }
    return changed;
  }

  // ─── Reading ─────────────────────────────────────────────────────────────────

  /** Relations of a symbol, or of a file when `symbol` is a path. See `RelationQuery`. */
  query(q: RelationQuery): RelationPage {
    this.resolvePendingNow();
    const exact = this.run(q, false);
    if (exact.total > 0 || exact.symbols > 0) return exact;
    return this.run(q, true);
  }

  private matchFiles(symbol: string): { id: number; filename: string }[] {
    const slashes = symbol.replaceAll('\\', '/');
    const looksLikePath = symbol.includes('/') || symbol.includes('\\');
    if (!looksLikePath && !isSupportedExtension(path.extname(symbol))) return [];
    const forward = likeEscape(slashes);
    const back = likeEscape(slashes.replaceAll('/', '\\'));
    return this.db
      .prepare<{ id: number; filename: string }>(
        "SELECT id, filename FROM documents WHERE doc_type = 'code' AND (filename = ? OR filename LIKE ? ESCAPE '!' OR filename LIKE ? ESCAPE '!') ORDER BY filename LIMIT 200",
      )
      .all(symbol, `%/${forward}`, `%\\${back}`);
  }

  private run(q: RelationQuery, nocase: boolean): RelationPage {
    const files = this.matchFiles(q.symbol);
    const fileMode = files.length > 0;
    const types: readonly RelationKind[] | undefined = q.types && q.types.length > 0 ? q.types : fileMode ? ['imports'] : undefined;
    const typeFilter = types ? ` AND cr.relation_type IN (${placeholders(types.length)})` : '';
    const typeArgs: SqlParam[] = types ? [...types] : [];

    const branches: { sql: string; args: SqlParam[] }[] = [];
    let sourceScope = '';
    let sourceArgs: SqlParam[] = [];
    let symbols: number;

    const addBranch = (dir: 'in' | 'out', condition: string, args: SqlParam[]): void => {
      branches.push({ sql: `${SELECT_ROWS}, '${dir}' AS dir ${FROM_ROWS} WHERE ${condition}${typeFilter} AND ${VISIBLE}`, args: [...args, ...typeArgs] });
    };

    if (fileMode) {
      symbols = files.length;
      const docIds = files.map((f) => f.id);
      const chunkSub = `SELECT id FROM chunks WHERE document_id IN (${placeholders(docIds.length)})`;
      sourceScope = `cr.source_chunk_id IN (${chunkSub})`;
      sourceArgs = docIds;
      if (q.direction !== 'in') addBranch('out', sourceScope, sourceArgs);
      if (q.direction !== 'out') {
        const names = files.map((f) => f.filename);
        addBranch(
          'in',
          `((cr.relation_type = 'imports' AND cr.target_file IN (${placeholders(names.length)})) OR (cr.relation_type IN ('calls','inherits') AND cr.target_chunk_id IN (${chunkSub})))`,
          [...names, ...docIds],
        );
      }
    } else {
      const parts = q.symbol.split(/::|\./).filter((p) => p !== '');
      const name = parts.at(-1) ?? q.symbol;
      const parent = parts.length > 1 ? parts.at(-2) : undefined;
      const collate = nocase ? ' COLLATE NOCASE' : '';
      const ids = this.db
        .prepare<{ chunk_id: number }>(
          `SELECT chunk_id FROM code_metadata WHERE symbol_name = ?${collate}${parent === undefined ? '' : ` AND parent_symbol = ?${collate}`} LIMIT ${String(MAX_CANDIDATE_CHUNKS)}`,
        )
        .all(...(parent === undefined ? [name] : [name, parent]))
        .map((r) => r.chunk_id);
      symbols = ids.length;
      if (ids.length > 0) {
        sourceScope = `cr.source_chunk_id IN (${placeholders(ids.length)})`;
        sourceArgs = ids;
      }
      if (q.direction !== 'in' && ids.length > 0) addBranch('out', `${sourceScope} AND cr.relation_type != 'imports'`, sourceArgs);
      if (q.direction !== 'out' && (parent === undefined || ids.length > 0)) {
        const edge = `cr.relation_type IN ('calls','inherits') AND cr.target_name = ?${collate}${parent === undefined ? '' : ` AND (cr.target_chunk_id IS NULL OR cr.target_chunk_id IN (${placeholders(ids.length)}))`}`;
        const edgeArgs: SqlParam[] = parent === undefined ? [name] : [name, ...ids];
        const wanted = nocase ? `lower(',${name},')` : '?';
        const imports = `cr.relation_type = 'imports' AND instr(${nocase ? 'lower(cr.names)' : 'cr.names'}, ${wanted}) > 0`;
        const importArgs: SqlParam[] = nocase ? [] : [`,${name},`];
        addBranch('in', parent === undefined ? `((${edge}) OR (${imports}))` : `(${edge})`, parent === undefined ? [...edgeArgs, ...importArgs] : edgeArgs);
      }
    }

    if (branches.length === 0) return { hits: [], total: 0, symbols, omitted: [] };

    const union = branches.map((b) => b.sql).join(' UNION ALL ');
    const args = branches.flatMap((b) => b.args);
    const total = this.db.prepare<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM (${union})`).get(...args)?.cnt ?? 0;
    const rows = this.db
      .prepare<QueryRow>(
        `SELECT * FROM (${union}) ORDER BY CASE dir WHEN 'out' THEN 0 ELSE 1 END,
           CASE relation_type WHEN 'inherits' THEN 0 WHEN 'imports' THEN 1 ELSE 2 END, confidence DESC, src_file, COALESCE(line, src_start), id LIMIT ? OFFSET ?`,
      )
      .all(...args, q.limit, q.offset);

    let omitted: RelationPage['omitted'] = [];
    if (q.direction !== 'in' && sourceScope !== '') {
      const capTypes = types ?? (['calls', 'inherits'] as const);
      omitted = this.db
        .prepare<{ relation_type: RelationKind; dropped: number }>(
          `SELECT cr.relation_type, SUM(cr.dropped) AS dropped FROM relation_caps cr WHERE ${sourceScope}
           AND cr.relation_type IN (${placeholders(capTypes.length)}) GROUP BY cr.relation_type ORDER BY cr.relation_type`,
        )
        .all(...sourceArgs, ...capTypes)
        .map((r) => ({ type: r.relation_type, count: r.dropped }));
    }

    return { hits: rows.map(toHit), total, symbols, omitted };
  }
}

/** A weak edge (call to a very common name) is shown only once an indexed symbol has resolved it, or it is ambiguous. */
const VISIBLE = '(cr.weak = 0 OR cr.target_chunk_id IS NOT NULL OR cr.confidence = 0.5)';

const SELECT_ROWS = `SELECT cr.id, cr.relation_type, cr.line, cr.target_name, cr.target_file, cr.confidence, cr.names,
  sd.filename AS src_file, sm.symbol_name AS src_name, sm.parent_symbol AS src_parent, sm.start_line AS src_start,
  td.filename AS tgt_file, tm.symbol_name AS tgt_name, tm.parent_symbol AS tgt_parent, tm.start_line AS tgt_start`;

const FROM_ROWS = `FROM code_relations cr
  JOIN chunks sc ON sc.id = cr.source_chunk_id
  JOIN documents sd ON sd.id = sc.document_id
  LEFT JOIN code_metadata sm ON sm.chunk_id = sc.id
  LEFT JOIN chunks tc ON tc.id = cr.target_chunk_id
  LEFT JOIN documents td ON td.id = tc.document_id
  LEFT JOIN code_metadata tm ON tm.chunk_id = tc.id`;

function toHit(row: QueryRow): RelationHit {
  return {
    direction: row.dir,
    type: row.relation_type,
    confidence: row.confidence ?? CONFIDENCE.importResolved,
    line: row.line ?? row.src_start ?? 0,
    source: { file: row.src_file, name: row.src_name ?? '', parent: row.src_parent ?? '', startLine: row.src_start ?? 0 },
    targetName: row.target_name,
    targetFile: row.target_file ?? '',
    names: fromNamesColumn(row.names),
    target: row.tgt_file === null ? undefined : { file: row.tgt_file, name: row.tgt_name ?? '', parent: row.tgt_parent ?? '', startLine: row.tgt_start ?? 0 },
  };
}
