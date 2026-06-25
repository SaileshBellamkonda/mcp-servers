import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { buildSchema } from './schema.js';
import type {
  MarkdownChunk,
  CodeChunk,
  CodeRelation,
  DocumentRecord,
  SearchResult,
  SearchFilter,
} from '../core/types.js';

const require = createRequire(import.meta.url);

function loadSqliteVec(db: Database.Database): void {
  try {
    const sqliteVec = require('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
  } catch (err) {
    throw new Error(`Failed to load sqlite-vec extension: ${String(err)}`);
  }
}

function serializeVector(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i] ?? 0, i * 4);
  }
  return buf;
}

export class VectorDB {
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Read the dimension stored in an existing database without loading sqlite-vec or
   * modifying the file. Returns null when the DB file does not exist or has no
   * stored dimension (i.e. it is a new / uninitialised database).
   */
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

    // Check stored dimensions vs requested
    db.exec(`CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const stored = (db.prepare('SELECT value FROM db_meta WHERE key = ?').get('dimensions') as { value: string } | undefined)?.value;

    if (stored !== undefined) {
      const storedDim = parseInt(stored, 10);
      if (storedDim !== dimensions) {
        db.close();
        throw new Error(
          `DB was created with ${String(storedDim)} dimensions but embedding endpoint returns ${String(dimensions)}. ` +
          `Delete the database file to start fresh with the new model.`
        );
      }
    } else {
      // First init: create schema and store dimensions
      db.exec(buildSchema(dimensions));
      db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run('dimensions', String(dimensions));
    }

    return new VectorDB(db);
  }

  close(): void {
    this.db.close();
  }

  getStoredDimensions(): number | null {
    const row = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get('dimensions') as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
  }

  listDocuments(): Map<string, Date> {
    const rows = this.db.prepare('SELECT filename, modified_at FROM documents').all() as { filename: string; modified_at: string }[];
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

  insertDocument(filename: string, modifiedAt: Date, chunks: MarkdownChunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`chunks (${String(chunks.length)}) and embeddings (${String(embeddings.length)}) count mismatch`);
    }

    const insertDoc = this.db.prepare(
      'INSERT OR REPLACE INTO documents (filename, modified_at, indexed_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );
    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (document_id, position, content) VALUES (?, ?, ?)'
    );
    const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
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
      }
    });

    run();
  }

  insertCodeDocument(filename: string, modifiedAt: Date, chunks: CodeChunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`chunks (${String(chunks.length)}) and embeddings (${String(embeddings.length)}) count mismatch`);
    }

    const insertDoc = this.db.prepare(
      'INSERT OR REPLACE INTO documents (filename, modified_at, indexed_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );
    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (document_id, position, content) VALUES (?, ?, ?)'
    );
    const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)');
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
        insertMeta.run(
          chunkId,
          chunk.symbolName,
          chunk.symbolType,
          chunk.language,
          chunk.startLine,
          chunk.endLine,
          chunk.parentSymbol,
          chunk.signature,
        );
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

  searchWithFilter(queryVector: number[], topK: number, filter: SearchFilter | null): SearchResult[] {
    const blob = serializeVector(queryVector);

    let whereClause = '';
    const whereArgs: unknown[] = [];

    if (filter) {
      const conditions: string[] = [];
      if (filter.directory) {
        const dir = filter.directory.replace(/[/\\]+$/, '');
        conditions.push('(d.filename LIKE ? OR d.filename LIKE ?)');
        whereArgs.push(`${dir}/%`, `${dir}\\%`);
      }
      if (filter.filePattern) {
        const likePattern = globToLike(filter.filePattern);
        conditions.push('(d.filename LIKE ? OR d.filename LIKE ?)');
        whereArgs.push(`%/${likePattern}`, likePattern);
      }
      if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }
    }

    const sql = `
      SELECT
        d.filename,
        c.content,
        c.position,
        c.id as chunk_id,
        vec_distance_cosine(v.embedding, ?) as distance,
        cm.symbol_name,
        cm.symbol_type,
        cm.language,
        cm.start_line,
        cm.end_line,
        cm.parent_symbol,
        cm.signature
      FROM vec_chunks v
      JOIN chunks c ON v.rowid = c.id
      JOIN documents d ON c.document_id = d.id
      LEFT JOIN code_metadata cm ON c.id = cm.chunk_id
      ${whereClause}
      ORDER BY distance ASC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(blob, ...whereArgs, topK) as {
      filename: string;
      content: string;
      position: number;
      chunk_id: number;
      distance: number | null;
      symbol_name: string | null;
      symbol_type: string | null;
      language: string | null;
      start_line: number | null;
      end_line: number | null;
      parent_symbol: string | null;
      signature: string | null;
    }[];

    return rows
      .filter((r) => r.distance !== null)
      .map((r) => ({
        document: r.filename,
        chunk: r.content,
        similarity: 1.0 - ((r.distance ?? 0) / 2.0),
        position: r.position,
        metadata: r.symbol_type
          ? {
              symbolName: r.symbol_name ?? '',
              symbolType: r.symbol_type,
              language: r.language ?? '',
              startLine: r.start_line ?? 0,
              endLine: r.end_line ?? 0,
              parentSymbol: r.parent_symbol ?? '',
              signature: r.signature ?? '',
            }
          : undefined,
      }));
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
      WHERE (${conditions})
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...args) as {
      filename: string; content: string; position: number; chunk_id: number;
      symbol_name: string; symbol_type: string; language: string;
      start_line: number; end_line: number; parent_symbol: string; signature: string;
    }[];

    return rows.map((r) => ({
      document: r.filename,
      chunk: r.content,
      similarity: 1.0,
      position: r.position,
      metadata: {
        symbolName: r.symbol_name,
        symbolType: r.symbol_type,
        language: r.language,
        startLine: r.start_line,
        endLine: r.end_line,
        parentSymbol: r.parent_symbol,
        signature: r.signature,
      },
    }));
  }

  findSymbolRelations(symbol: string, direction: string, relationType: string): CodeRelation[] {
    let sql: string;
    const args: unknown[] = [];

    if (direction === 'incoming') {
      sql = `
        SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type,
               cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
        FROM code_relations cr
        JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
        JOIN chunks c ON cm.chunk_id = c.id
        JOIN documents d ON c.document_id = d.id
        WHERE cr.target_name = ?`;
      args.push(symbol);
    } else if (direction === 'outgoing') {
      sql = `
        SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type,
               cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
        FROM code_relations cr
        JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
        JOIN chunks c ON cm.chunk_id = c.id
        JOIN documents d ON c.document_id = d.id
        WHERE cm.symbol_name = ?`;
      args.push(symbol);
    } else {
      sql = `
        SELECT cr.id, cr.source_chunk_id, cr.target_chunk_id, cr.relation_type,
               cr.target_name, cr.target_file, cr.confidence,
               cm.symbol_name as source_name, d.filename as source_file
        FROM code_relations cr
        JOIN code_metadata cm ON cr.source_chunk_id = cm.chunk_id
        JOIN chunks c ON cm.chunk_id = c.id
        JOIN documents d ON c.document_id = d.id
        WHERE cr.target_name = ? OR cm.symbol_name = ?`;
      args.push(symbol, symbol);
    }

    if (relationType) {
      sql += ' AND cr.relation_type = ?';
      args.push(relationType);
    }

    const rows = this.db.prepare(sql).all(...args) as {
      id: number; source_chunk_id: number; target_chunk_id: number | null;
      relation_type: string; target_name: string; target_file: string;
      confidence: number; source_name: string; source_file: string;
    }[];

    return rows.map((r) => ({
      id: r.id,
      sourceChunkId: r.source_chunk_id,
      targetChunkId: r.target_chunk_id ?? undefined,
      relationType: r.relation_type,
      targetName: r.target_name,
      targetFile: r.target_file,
      confidence: r.confidence,
      sourceName: r.source_name,
      sourceFile: r.source_file,
    }));
  }

  getAllDocumentRecords(): DocumentRecord[] {
    const rows = this.db.prepare('SELECT filename, modified_at FROM documents').all() as { filename: string; modified_at: string }[];
    return rows.map((r) => ({ filename: r.filename, modifiedAt: new Date(r.modified_at) }));
  }
}

function globToLike(pattern: string): string {
  return pattern.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\*/g, '%').replace(/\?/g, '_');
}
