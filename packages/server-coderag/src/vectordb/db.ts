import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { buildSchema, buildMigrations, buildDocMetadataMigration } from './schema.js';
import type {
  MarkdownChunk,
  CodeChunk,
  CodeRelation,
  DocumentRecord,
  DocumentMetadata,
  SearchResult,
  SearchFilter,
  GlobConfig,
} from '../core/types.js';

const require = createRequire(import.meta.url);

function loadSqliteVec(db: Database.Database): void {
  try {
    const sqliteVec = require('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
  } catch (err) {
    throw new Error(`Failed to load sqlite-vec extension: ${String(err)}`, { cause: err });
  }
}

function serializeVector(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i] ?? 0, i * 4);
  }
  return buf;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM pragma_table_info(?) WHERE name=?`)
    .get(table, column) as { cnt: number };
  return row.cnt > 0;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

function virtualTableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

function runMigrations(db: Database.Database): void {
  const migrations = buildMigrations();
  // Migration 1: add doc_type column
  if (tableExists(db, 'documents') && !columnExists(db, 'documents', 'doc_type')) {
    if (migrations[0]) db.exec(migrations[0]);
    if (migrations[1]) db.exec(migrations[1]);
  }
  // Migration 2: create index_rules table
  if (!tableExists(db, 'index_rules')) {
    if (migrations[2]) db.exec(migrations[2]);
  }
  // Migration 3: create FTS5 table, trigger, and backfill
  if (!virtualTableExists(db, 'fts_chunks')) {
    if (migrations[3]) db.exec(migrations[3]);
    if (migrations[4]) db.exec(migrations[4]);
    if (migrations[5]) db.exec(migrations[5]);
  }
  // Migration 4: document metadata tables + chunk location columns. Existing docs were embedded
  // without heading/metadata context, so flag them for a forced re-index on the next startup sync.
  if (!tableExists(db, 'doc_metadata')) {
    const docMetadata = buildDocMetadataMigration();
    for (const statement of docMetadata.statements) db.exec(statement);
    for (const column of docMetadata.chunkColumns) {
      if (!columnExists(db, 'chunks', column.name)) db.exec(column.ddl);
    }
    db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('docs_reindex_required', '1');
  }
}

// Columns shared by the semantic and keyword search queries (aliases: c=chunks, d=documents,
// cm=code_metadata, dm=doc_metadata).
const SEARCH_COLUMNS = `d.filename, c.content, c.position, c.id as chunk_id, d.id as doc_id,
         cm.symbol_name, cm.symbol_type, cm.language,
         cm.start_line, cm.end_line, cm.parent_symbol, cm.signature,
         c.heading_path, c.start_line as chunk_start_line, c.end_line as chunk_end_line,
         dm.document_id as dm_doc_id, dm.title as dm_title, dm.doc_type as dm_doc_type,
         dm.domain as dm_domain, dm.project as dm_project`;

interface SearchRow {
  filename: string;
  content: string;
  position: number;
  chunk_id: number;
  doc_id: number;
  symbol_name: string | null;
  symbol_type: string | null;
  language: string | null;
  start_line: number | null;
  end_line: number | null;
  parent_symbol: string | null;
  signature: string | null;
  heading_path: string | null;
  chunk_start_line: number | null;
  chunk_end_line: number | null;
  dm_doc_id: number | null;
  dm_title: string | null;
  dm_doc_type: string | null;
  dm_domain: string | null;
  dm_project: string | null;
}

export class VectorDB {
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static readStoredDimensions(dbPath: string): number | null {
    if (dbPath === ':memory:') return null;
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.prepare('SELECT value FROM db_meta WHERE key = ?').get('dimensions') as { value: string } | undefined;
        return row ? parseInt(row.value, 10) : null;
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  static open(dbPath: string, dimensions: number): VectorDB {
    const db = new Database(dbPath);
    loadSqliteVec(db);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    db.exec(`CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const stored = (db.prepare('SELECT value FROM db_meta WHERE key = ?').get('dimensions') as { value: string } | undefined)?.value;

    if (stored !== undefined) {
      const storedDim = parseInt(stored, 10);
      if (storedDim !== dimensions) {
        // Dimension mismatch: drop and recreate vec_chunks, update stored dim
        db.exec('DROP TABLE IF EXISTS vec_chunks');
        db.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding FLOAT[${String(dimensions)}])`);
        db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('dimensions', String(dimensions));
        db.prepare('DELETE FROM db_meta WHERE key = ?').run('last_docs_sync_at');
        db.prepare('DELETE FROM db_meta WHERE key = ?').run('last_code_sync_at');
      }
    } else {
      db.exec(buildSchema(dimensions));
      db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('dimensions', String(dimensions));
    }

    runMigrations(db);
    return new VectorDB(db);
  }

  close(): void {
    this.db.close();
  }

  getStoredDimensions(): number | null {
    const row = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get('dimensions') as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
  }

  dimensionMismatchOccurred(): boolean {
    const row = this.db.prepare("SELECT value FROM db_meta WHERE key = 'dim_reset'").get() as { value: string } | undefined;
    return row?.value === '1';
  }

  isDocsReindexRequired(): boolean {
    const row = this.db.prepare("SELECT value FROM db_meta WHERE key = 'docs_reindex_required'").get() as { value: string } | undefined;
    return row?.value === '1';
  }

  requireDocsReindex(): void {
    this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('docs_reindex_required', '1');
  }

  clearDocsReindexRequired(): void {
    this.db.prepare("DELETE FROM db_meta WHERE key = 'docs_reindex_required'").run();
  }

  getDocumentCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number };
    return row.cnt;
  }

  getDocumentCountByType(docType: 'doc' | 'code'): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM documents WHERE doc_type = ?').get(docType) as { cnt: number };
    return row.cnt;
  }

  listDocuments(): Map<string, Date> {
    const rows = this.db.prepare('SELECT filename, modified_at FROM documents').all() as { filename: string; modified_at: string }[];
    const result = new Map<string, Date>();
    for (const row of rows) {
      result.set(row.filename, new Date(row.modified_at));
    }
    return result;
  }

  listDocumentsByType(docType: 'doc' | 'code'): Map<string, Date> {
    const rows = this.db.prepare('SELECT filename, modified_at FROM documents WHERE doc_type = ?').all(docType) as { filename: string; modified_at: string }[];
    const result = new Map<string, Date>();
    for (const row of rows) {
      result.set(row.filename, new Date(row.modified_at));
    }
    return result;
  }

  deleteDocument(filename: string): void {
    const doc = this.db.prepare('SELECT id FROM documents WHERE filename = ?').get(filename) as { id: number } | undefined;
    if (!doc) throw new Error(`Document not found: ${filename}`);
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  }

  insertDocument(
    filename: string,
    modifiedAt: Date,
    chunks: MarkdownChunk[],
    embeddings: number[][],
    metadata?: DocumentMetadata,
  ): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`chunks (${String(chunks.length)}) and embeddings (${String(embeddings.length)}) count mismatch`);
    }

    const findDoc = this.db.prepare('SELECT id FROM documents WHERE filename = ?');
    const deleteMeta = this.db.prepare('DELETE FROM doc_metadata WHERE document_id = ?');
    const deleteTags = this.db.prepare('DELETE FROM doc_tags WHERE document_id = ?');
    const insertDoc = this.db.prepare(
      'INSERT OR REPLACE INTO documents (filename, doc_type, modified_at, indexed_at) VALUES (?, \'doc\', ?, CURRENT_TIMESTAMP)'
    );
    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (document_id, position, content, heading_path, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
    const insertFts = this.db.prepare('INSERT INTO fts_chunks(rowid, content, symbol_name) VALUES (?, ?, ?)');
    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE document_id = ?');
    const insertMeta = this.db.prepare(
      'INSERT INTO doc_metadata (document_id, title, doc_type, domain, project, language, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO doc_tags (document_id, tag) VALUES (?, ?)');

    const run = this.db.transaction(() => {
      // Metadata rows hang off the old document id; remove them explicitly before the REPLACE assigns a new id.
      const existing = findDoc.get(filename) as { id: number } | undefined;
      if (existing) {
        deleteMeta.run(existing.id);
        deleteTags.run(existing.id);
      }

      const docResult = insertDoc.run(filename, modifiedAt.toISOString());
      const docId = Number(docResult.lastInsertRowid);
      deleteChunks.run(docId);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!chunk || !embedding) continue;
        const headingPath = chunk.headingPath && chunk.headingPath.length > 0 ? chunk.headingPath : null;
        const chunkResult = insertChunk.run(
          docId,
          chunk.position,
          chunk.content,
          headingPath ? JSON.stringify(headingPath) : null,
          chunk.startLine ?? null,
          chunk.endLine ?? null,
        );
        const chunkId = BigInt(chunkResult.lastInsertRowid);
        insertVec.run(chunkId, serializeVector(embedding));
        const ftsHeading = [metadata?.title ?? '', ...(headingPath ?? [])].filter((part) => part !== '').join(' ');
        insertFts.run(chunkId, chunk.content, ftsHeading);
      }

      if (metadata) {
        insertMeta.run(
          docId,
          metadata.title ?? null,
          metadata.docType ?? null,
          metadata.domain ?? null,
          metadata.project ?? null,
          metadata.language ?? null,
          Object.keys(metadata.extra).length > 0 ? JSON.stringify(metadata.extra) : null,
        );
        for (const tag of metadata.tags) insertTag.run(docId, tag);
      }
    });
    run();
  }

  insertCodeDocument(filename: string, modifiedAt: Date, chunks: CodeChunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`chunks (${String(chunks.length)}) and embeddings (${String(embeddings.length)}) count mismatch`);
    }

    const insertDoc = this.db.prepare(
      'INSERT OR REPLACE INTO documents (filename, doc_type, modified_at, indexed_at) VALUES (?, \'code\', ?, CURRENT_TIMESTAMP)'
    );
    const insertChunk = this.db.prepare('INSERT INTO chunks (document_id, position, content) VALUES (?, ?, ?)');
    const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
    const insertFts = this.db.prepare('INSERT INTO fts_chunks(rowid, content, symbol_name) VALUES (?, ?, ?)');
    const insertMeta = this.db.prepare(
      'INSERT INTO code_metadata (chunk_id, symbol_name, symbol_type, language, start_line, end_line, parent_symbol, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE document_id = ?');

    const run = this.db.transaction(() => {
      const docResult = insertDoc.run(filename, modifiedAt.toISOString());
      const docId = Number(docResult.lastInsertRowid);
      deleteChunks.run(docId);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!chunk || !embedding) continue;
        const chunkResult = insertChunk.run(docId, chunk.position, chunk.content);
        const chunkId = BigInt(chunkResult.lastInsertRowid);
        insertVec.run(chunkId, serializeVector(embedding));
        insertFts.run(chunkId, chunk.content, chunk.symbolName ?? '');
        insertMeta.run(chunkId, chunk.symbolName, chunk.symbolType, chunk.language, chunk.startLine, chunk.endLine, chunk.parentSymbol, chunk.signature);
      }
    });
    run();
  }

  insertRelations(relations: CodeRelation[]): void {
    if (relations.length === 0) return;
    const stmt = this.db.prepare(
      'INSERT INTO code_relations (source_chunk_id, target_chunk_id, relation_type, target_name, target_file, confidence) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const run = this.db.transaction(() => {
      for (const rel of relations) {
        stmt.run(rel.sourceChunkId, rel.targetChunkId ?? null, rel.relationType, rel.targetName, rel.targetFile, rel.confidence);
      }
    });
    run();
  }

  getChunkIdBySymbol(filename: string, symbolName: string): number | null {
    const row = this.db.prepare(`
      SELECT cm.chunk_id FROM code_metadata cm
      JOIN chunks c ON cm.chunk_id = c.id
      JOIN documents d ON c.document_id = d.id
      WHERE d.filename = ? AND cm.symbol_name = ? LIMIT 1
    `).get(filename, symbolName) as { chunk_id: number } | undefined;
    return row?.chunk_id ?? null;
  }

  // ─── Rule storage ──────────────────────────────────────────────────────────

  saveRules(globs: GlobConfig): void {
    const del = this.db.prepare('DELETE FROM index_rules WHERE rule_type = ?');
    const ins = this.db.prepare('INSERT INTO index_rules (rule_type, pattern) VALUES (?, ?)');
    this.db.transaction(() => {
      for (const type of ['docs_include', 'docs_exclude', 'code_include', 'code_exclude'] as const) {
        del.run(type);
      }
      for (const p of globs.docsInclude) ins.run('docs_include', p);
      for (const p of globs.docsExclude) ins.run('docs_exclude', p);
      for (const p of globs.codeInclude) ins.run('code_include', p);
      for (const p of globs.codeExclude) ins.run('code_exclude', p);
    })();
  }

  getStoredRules(): GlobConfig | null {
    if (!tableExists(this.db, 'index_rules')) return null;
    const rows = this.db.prepare('SELECT rule_type, pattern FROM index_rules ORDER BY id').all() as { rule_type: string; pattern: string }[];
    if (rows.length === 0) return null;
    const result: GlobConfig = { docsInclude: [], docsExclude: [], codeInclude: [], codeExclude: [] };
    for (const row of rows) {
      if (row.rule_type === 'docs_include') result.docsInclude.push(row.pattern);
      else if (row.rule_type === 'docs_exclude') result.docsExclude.push(row.pattern);
      else if (row.rule_type === 'code_include') result.codeInclude.push(row.pattern);
      else if (row.rule_type === 'code_exclude') result.codeExclude.push(row.pattern);
    }
    return result;
  }

  // ─── Sync timestamps ───────────────────────────────────────────────────────

  getLastSyncAt(type: 'docs' | 'code'): Date | null {
    const key = type === 'docs' ? 'last_docs_sync_at' : 'last_code_sync_at';
    const row = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? new Date(row.value) : null;
  }

  setLastSyncAt(type: 'docs' | 'code', date: Date): void {
    const key = type === 'docs' ? 'last_docs_sync_at' : 'last_code_sync_at';
    this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run(key, date.toISOString());
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  searchWithFilter(queryVector: number[], topK: number, filter: SearchFilter | null): SearchResult[] {
    const blob = serializeVector(queryVector);
    const { conditions, args } = buildFilterConditions(filter);
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT ${SEARCH_COLUMNS},
             vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_chunks v
      JOIN chunks c ON v.rowid = c.id
      JOIN documents d ON c.document_id = d.id
      LEFT JOIN code_metadata cm ON c.id = cm.chunk_id
      LEFT JOIN doc_metadata dm ON dm.document_id = d.id
      ${whereClause}
      ORDER BY distance ASC LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(blob, ...args, topK) as (SearchRow & { distance: number | null })[];

    return this.toResults(
      rows.filter((r) => r.distance !== null),
      (r) => 1.0 - ((r.distance ?? 0) / 2.0),
    );
  }

  searchSymbolsByKeywords(keywords: string[], limit: number): SearchResult[] {
    if (keywords.length === 0) return [];
    const conditions = keywords.map(() => 'LOWER(cm.symbol_name) LIKE ?').join(' OR ');
    const args: unknown[] = keywords.map((k) => `%${k.toLowerCase()}%`);
    args.push(limit);
    const sql = `
      SELECT d.filename, c.content, c.position, c.id as chunk_id,
             cm.symbol_name, cm.symbol_type, cm.language,
             cm.start_line, cm.end_line, cm.parent_symbol, cm.signature
      FROM code_metadata cm
      JOIN chunks c ON cm.chunk_id = c.id
      JOIN documents d ON c.document_id = d.id
      WHERE (${conditions}) LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...args) as {
      filename: string; content: string; position: number; chunk_id: number;
      symbol_name: string; symbol_type: string; language: string;
      start_line: number; end_line: number; parent_symbol: string; signature: string;
    }[];
    return rows.map((r) => ({
      document: r.filename, chunk: r.content, similarity: 1.0, position: r.position,
      metadata: { symbolName: r.symbol_name, symbolType: r.symbol_type, language: r.language,
                  startLine: r.start_line, endLine: r.end_line, parentSymbol: r.parent_symbol, signature: r.signature },
    }));
  }

  findSymbolRelations(symbol: string, direction: string, relationType: string): CodeRelation[] {
    let sql: string;
    const args: unknown[] = [];
    if (direction === 'incoming') {
      sql = `SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type, cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
             FROM code_relations cr JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
             JOIN chunks c ON cm.chunk_id = c.id JOIN documents d ON c.document_id = d.id
             WHERE cr.target_name = ?`;
      args.push(symbol);
    } else if (direction === 'outgoing') {
      sql = `SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type, cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
             FROM code_relations cr JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
             JOIN chunks c ON cm.chunk_id = c.id JOIN documents d ON c.document_id = d.id
             WHERE cm.symbol_name = ?`;
      args.push(symbol);
    } else {
      sql = `SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type, cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
             FROM code_relations cr JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
             JOIN chunks c ON cm.chunk_id = c.id JOIN documents d ON c.document_id = d.id
             WHERE cr.target_name = ? OR cm.symbol_name = ?`;
      args.push(symbol, symbol);
    }
    if (relationType) { sql += ' AND cr.relation_type = ?'; args.push(relationType); }
    const rows = this.db.prepare(sql).all(...args) as {
      id: number; source_chunk_id: number; target_chunk_id: number | null;
      relation_type: string; target_name: string; target_file: string;
      confidence: number; source_name: string; source_file: string;
    }[];
    return rows.map((r) => ({
      id: r.id, sourceChunkId: r.source_chunk_id, targetChunkId: r.target_chunk_id ?? undefined,
      relationType: r.relation_type, targetName: r.target_name, targetFile: r.target_file,
      confidence: r.confidence, sourceName: r.source_name, sourceFile: r.source_file,
    }));
  }

  getAllDocumentRecords(): DocumentRecord[] {
    const rows = this.db.prepare('SELECT filename, modified_at, doc_type FROM documents').all() as { filename: string; modified_at: string; doc_type: string }[];
    return rows.map((r) => ({ filename: r.filename, modifiedAt: new Date(r.modified_at), docType: r.doc_type as 'doc' | 'code' }));
  }

  // ─── FTS5 keyword search ───────────────────────────────────────────────────

  searchByKeyword(query: string, topK: number, filter: SearchFilter | null): SearchResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    const { conditions, args } = buildFilterConditions(filter);
    const whereClause = ['fts_chunks MATCH ?', ...conditions].join(' AND ');

    const sql = `
      SELECT ${SEARCH_COLUMNS},
             bm25(fts_chunks) as bm25_score
      FROM fts_chunks
      JOIN chunks c ON fts_chunks.rowid = c.id
      JOIN documents d ON c.document_id = d.id
      LEFT JOIN code_metadata cm ON c.id = cm.chunk_id
      LEFT JOIN doc_metadata dm ON dm.document_id = d.id
      WHERE ${whereClause}
      ORDER BY bm25(fts_chunks)
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(ftsQuery, ...args, topK) as (SearchRow & { bm25_score: number })[];

    // bm25() returns negative values; normalize to (0,1] — lower bm25 = more relevant
    return this.toResults(rows, (r) => 1.0 / (1.0 + Math.abs(r.bm25_score)));
  }

  searchHybrid(queryVector: number[], query: string, topK: number, filter: SearchFilter | null): SearchResult[] {
    const fetch = topK * 3; // over-fetch to improve merge quality
    const semantic = this.searchWithFilter(queryVector, fetch, filter);
    const keyword = this.searchByKeyword(query, fetch, filter);

    // Reciprocal Rank Fusion (k=60)
    const RRF_K = 60;
    const scores = new Map<number, number>(); // chunk_id → rrf score
    const chunkMeta = new Map<number, SearchResult>();

    for (let i = 0; i < semantic.length; i++) {
      const r = semantic[i];
      if (!r) continue;
      const id = (r as SearchResult & { chunkId?: number }).chunkId ?? i;
      scores.set(i, (scores.get(i) ?? 0) + 1 / (RRF_K + i + 1));
      chunkMeta.set(i, r);
    }

    // Re-index keyword results by position in the semantic results to merge by content
    // Since we don't have chunk IDs on SearchResult, merge by (document, position) identity
    const semanticKey = (r: SearchResult): string => `${r.document}::${String(r.position)}`;
    const keyToSemIdx = new Map<string, number>();
    for (let i = 0; i < semantic.length; i++) {
      const r = semantic[i];
      if (r) keyToSemIdx.set(semanticKey(r), i);
    }

    // Track keyword-only hits (not in semantic results) starting after semantic range
    let nextSlot = semantic.length;
    for (let i = 0; i < keyword.length; i++) {
      const r = keyword[i];
      if (!r) continue;
      const key = semanticKey(r);
      let slot = keyToSemIdx.get(key);
      if (slot === undefined) {
        slot = nextSlot++;
        chunkMeta.set(slot, r);
      }
      scores.set(slot, (scores.get(slot) ?? 0) + 1 / (RRF_K + i + 1));
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([slot, score]) => {
        const r = chunkMeta.get(slot);
        if (!r) return null;
        return { ...r, similarity: score };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  private loadTags(docIds: number[]): Map<number, string[]> {
    const tagsByDoc = new Map<number, string[]>();
    if (docIds.length === 0) return tagsByDoc;
    const placeholders = docIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT document_id, tag FROM doc_tags WHERE document_id IN (${placeholders}) ORDER BY tag`)
      .all(...docIds) as { document_id: number; tag: string }[];
    for (const row of rows) {
      const tags = tagsByDoc.get(row.document_id) ?? [];
      tags.push(row.tag);
      tagsByDoc.set(row.document_id, tags);
    }
    return tagsByDoc;
  }

  private toResults<T extends SearchRow>(rows: T[], similarityOf: (row: T) => number): SearchResult[] {
    const docIds = [...new Set(rows.filter((r) => r.dm_doc_id !== null).map((r) => r.doc_id))];
    const tagsByDoc = this.loadTags(docIds);
    return rows.map((r) => ({
      document: r.filename,
      chunk: r.content,
      similarity: similarityOf(r),
      position: r.position,
      metadata: r.symbol_type
        ? { symbolName: r.symbol_name ?? '', symbolType: r.symbol_type, language: r.language ?? '',
            startLine: r.start_line ?? 0, endLine: r.end_line ?? 0,
            parentSymbol: r.parent_symbol ?? '', signature: r.signature ?? '' }
        : undefined,
      headingPath: parseHeadingPath(r.heading_path),
      startLine: r.chunk_start_line ?? undefined,
      endLine: r.chunk_end_line ?? undefined,
      docMetadata: r.dm_doc_id !== null
        ? { title: r.dm_title ?? '', tags: tagsByDoc.get(r.doc_id) ?? [], docType: r.dm_doc_type ?? '',
            domain: r.dm_domain ?? '', project: r.dm_project ?? '' }
        : undefined,
    }));
  }
}

function globToLike(pattern: string): string {
  return pattern.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\*/g, '%').replace(/\?/g, '_');
}

function buildFtsQuery(query: string): string {
  // Split into terms and quote each to handle FTS5 special characters
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
}

function parseHeadingPath(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((p): p is string => typeof p === 'string') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the shared WHERE conditions for semantic and keyword search (aliases d=documents, dm=doc_metadata).
 * Any metadata filter implicitly excludes documents that have no doc_metadata row, such as code files.
 */
function buildFilterConditions(filter: SearchFilter | null): { conditions: string[]; args: unknown[] } {
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (!filter) return { conditions, args };

  if (filter.directory) {
    const dir = filter.directory.replace(/[/\\]+$/, '');
    conditions.push('(d.filename LIKE ? OR d.filename LIKE ?)');
    args.push(`${dir}/%`, `${dir}\\%`);
  }
  if (filter.filePattern) {
    const likePattern = globToLike(filter.filePattern);
    conditions.push('(d.filename LIKE ? OR d.filename LIKE ?)');
    args.push(`%/${likePattern}`, likePattern);
  }
  if (filter.docType) {
    conditions.push('dm.doc_type = ? COLLATE NOCASE');
    args.push(filter.docType);
  }
  if (filter.domain) {
    conditions.push('dm.domain = ? COLLATE NOCASE');
    args.push(filter.domain);
  }
  if (filter.project) {
    conditions.push('dm.project = ? COLLATE NOCASE');
    args.push(filter.project);
  }
  for (const tag of filter.tags ?? []) {
    conditions.push('EXISTS (SELECT 1 FROM doc_tags dt WHERE dt.document_id = d.id AND dt.tag = ?)');
    args.push(tag.trim().toLowerCase());
  }
  return { conditions, args };
}
