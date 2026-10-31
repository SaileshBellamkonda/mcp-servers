import { describe, it, expect } from 'vitest';
import { openSqliteDatabase } from '../../../src/vectordb/sqlite-db.ts';
import { RELATIONS_AUX_DDL, RELATIONS_TABLE_DDL } from '../../../src/vectordb/schema.ts';
import { IMPORTED_FILES_SQL, IMPORTS_BY_STEM_SQL } from '../../../src/vectordb/relations-store.ts';

function planOf(sql: string, ...args: (string | number)[]): string[] {
  const db = openSqliteDatabase(':memory:');
  try {
    db.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY, filename TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, position INTEGER, content TEXT);
      CREATE INDEX idx_document_id ON chunks(document_id);
      CREATE TABLE code_metadata (id INTEGER PRIMARY KEY, chunk_id INTEGER NOT NULL UNIQUE, language TEXT);
      ${RELATIONS_TABLE_DDL}
      ${RELATIONS_AUX_DDL}`);
    return db.prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
  } finally {
    db.close();
  }
}

describe('the lookup of the files a document imports', () => {
  it('starts from the chunks of the document, not from every import of the index', () => {
    // Resolving the calls of a large index runs this once per document; scanning all imports each time made the
    // resolution pass quadratic (about 30 s of a 65 s index of 1,500 files).
    const plan = planOf(IMPORTED_FILES_SQL, 1);
    expect(plan.some((line) => line.includes('idx_document_id'))).toBe(true);
    expect(plan.some((line) => line.includes('idx_rel_source'))).toBe(true);
    expect(plan.some((line) => line.includes('idx_rel_type'))).toBe(false);
  });
});

describe('the lookup of imports that a new file may change', () => {
  it('reads the imports, not every call, which also has an empty target file', () => {
    // Calls and inheritance rows store '' as target_file too (70,000 of them against 8,000 unresolved imports in a
    // 1,500 file index), so an index on target_file alone made every new file scan all of them.
    const plan = planOf(IMPORTS_BY_STEM_SQL, 100, '%util%');
    expect(plan.some((line) => /idx_rel_type(?:_file)? \(relation_type=\?/.test(line))).toBe(true);
    expect(plan.some((line) => line.includes('idx_rel_file '))).toBe(false);
  });
});
