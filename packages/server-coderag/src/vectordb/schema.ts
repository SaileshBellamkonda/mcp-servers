const DOC_METADATA_DDL = `
CREATE TABLE IF NOT EXISTS doc_metadata (
  document_id INTEGER PRIMARY KEY,
  title       TEXT,
  doc_type    TEXT,
  domain      TEXT,
  project     TEXT,
  language    TEXT,
  extra_json  TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doc_tags (
  document_id INTEGER NOT NULL,
  tag         TEXT    NOT NULL,
  PRIMARY KEY (document_id, tag),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_tags_tag ON doc_tags(tag);
`;

/**
 * DDL for the vec0 vector table. New tables use chunk_size=256: the default (1024) allocates ~3 MB blobs at 768
 * dimensions, which blocks the event loop for seconds during bulk inserts. Existing tables are never altered.
 */
export function buildVecChunksDdl(dimensions: number, ifNotExists = false): string {
  return `CREATE VIRTUAL TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}vec_chunks USING vec0(
  embedding FLOAT[${String(dimensions)}],
  chunk_size=256
)`;
}

/** Column order of `fts_chunks`; `FTS_BM25_WEIGHTS` is positional and must follow it. */
export const FTS_COLUMNS = ['symbol_name', 'signature', 'context', 'content'] as const;

/**
 * BM25 column weights, one per `FTS_COLUMNS` entry: a hit in the symbol name counts most, then the signature, then
 * the file path / heading context, and the body text least.
 */
export const FTS_BM25_WEIGHTS = [10, 5, 3, 1] as const;

/**
 * DDL for the keyword index. `porter unicode61` lowercases, folds diacritics and stems (`embeddings` finds
 * `embedding`); `tokenchars '_'` keeps `snake_case` identifiers as one token (their words are indexed too, see
 * fts-text.ts). The delete trigger keeps the index in step with `chunks`; inserts are done by VectorDB.
 */
export function buildFtsDdl(): string {
  return `CREATE VIRTUAL TABLE fts_chunks USING fts5(
  ${FTS_COLUMNS.join(',\n  ')},
  tokenize='porter unicode61 remove_diacritics 2 tokenchars _'
)`;
}

export const FTS_DELETE_TRIGGER_DDL = `CREATE TRIGGER IF NOT EXISTS fts_chunks_delete AFTER DELETE ON chunks BEGIN
  DELETE FROM fts_chunks WHERE rowid = old.id;
END`;

export function buildSchema(dimensions: number): string {
  return `
CREATE TABLE IF NOT EXISTS db_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    NOT NULL UNIQUE,
  doc_type    TEXT    NOT NULL DEFAULT 'doc' CHECK(doc_type IN ('doc','code')),
  indexed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_doc_type ON documents(doc_type);

CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  position     INTEGER NOT NULL,
  content      TEXT    NOT NULL,
  heading_path TEXT,
  start_line   INTEGER,
  end_line     INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_id ON chunks(document_id);

${buildVecChunksDdl(dimensions, true)};

CREATE TABLE IF NOT EXISTS code_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id      INTEGER NOT NULL UNIQUE,
  symbol_name   TEXT,
  symbol_type   TEXT NOT NULL,
  language      TEXT NOT NULL,
  start_line    INTEGER,
  end_line      INTEGER,
  parent_symbol TEXT,
  signature     TEXT,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_code_symbol   ON code_metadata(symbol_name);
CREATE INDEX IF NOT EXISTS idx_code_language ON code_metadata(language);
CREATE INDEX IF NOT EXISTS idx_code_type     ON code_metadata(symbol_type);

CREATE TABLE IF NOT EXISTS code_relations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_chunk_id INTEGER NOT NULL,
  target_chunk_id INTEGER,
  relation_type   TEXT    NOT NULL,
  target_name     TEXT    NOT NULL,
  target_file     TEXT,
  confidence      REAL    DEFAULT 1.0,
  FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (target_chunk_id) REFERENCES chunks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON code_relations(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON code_relations(target_chunk_id);
CREATE INDEX IF NOT EXISTS idx_rel_type   ON code_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_rel_name   ON code_relations(target_name);

CREATE TABLE IF NOT EXISTS index_rules (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('docs_include','docs_exclude','code_include','code_exclude')),
  pattern   TEXT NOT NULL
);

${DOC_METADATA_DDL}
`;
}

export function buildMigrations(): string[] {
  return [
    // Migration 1: add doc_type column if missing
    `ALTER TABLE documents ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'doc'`,
    // Migration 2: back-fill code documents based on presence of code_metadata
    `UPDATE documents SET doc_type = 'code'
     WHERE id IN (
       SELECT DISTINCT d.id FROM documents d
       JOIN chunks c ON c.document_id = d.id
       JOIN code_metadata cm ON cm.chunk_id = c.id
     ) AND doc_type = 'doc'`,
    // Migration 3: create index_rules table
    `CREATE TABLE IF NOT EXISTS index_rules (
       id        INTEGER PRIMARY KEY AUTOINCREMENT,
       rule_type TEXT NOT NULL,
       pattern   TEXT NOT NULL
     )`,
    // The FTS5 table is not created here: VectorDB builds it (and rebuilds it when FTS_VERSION changes), see buildFtsDdl.
  ];
}

export interface DocMetadataMigration {
  /** Idempotent statements creating doc_metadata, doc_tags and their index. */
  statements: string[];
  /** Columns added to `chunks`; each is applied only when the column is missing. */
  chunkColumns: { name: string; ddl: string }[];
}

export function buildDocMetadataMigration(): DocMetadataMigration {
  return {
    statements: [DOC_METADATA_DDL],
    chunkColumns: [
      { name: 'heading_path', ddl: 'ALTER TABLE chunks ADD COLUMN heading_path TEXT' },
      { name: 'start_line', ddl: 'ALTER TABLE chunks ADD COLUMN start_line INTEGER' },
      { name: 'end_line', ddl: 'ALTER TABLE chunks ADD COLUMN end_line INTEGER' },
    ],
  };
}
