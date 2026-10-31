import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { VectorDB } from '../../../src/vectordb/db.ts';
import type { DocumentMetadata, MarkdownChunk } from '../../../src/core/types.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-doc-metadata-test');

const DIM = 4;
const VEC = [0.1, 0.2, 0.3, 0.4];

function meta(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return { title: 'Guide', tags: [], extra: {}, ...overrides };
}

function chunk(content: string, extra: Partial<MarkdownChunk> = {}): MarkdownChunk {
  return { content, position: 0, ...extra };
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('docs re-index flag', () => {
  it('is not set on a fresh database and can be toggled', () => {
    const db = VectorDB.open(':memory:', DIM);
    expect(db.isDocsReindexRequired()).toBe(false);
    db.requireDocsReindex();
    expect(db.isDocsReindexRequired()).toBe(true);
    db.clearDocsReindexRequired();
    expect(db.isDocsReindexRequired()).toBe(false);
    db.close();
  });
});

describe('schema migration', () => {
  it('upgrades a pre-metadata database: adds tables and columns and requires a docs re-index', () => {
    const dbPath = path.join(tmpDir, 'upgrade.db');

    const first = VectorDB.open(dbPath, DIM);
    expect(first.isDocsReindexRequired()).toBe(false);
    first.close();

    // Simulate a database created before this feature existed.
    const raw = new DatabaseSync(dbPath, { allowExtension: true });
    (require('sqlite-vec') as { load: (db: DatabaseSync) => void }).load(raw);
    raw.exec(
      'DROP TABLE doc_tags; DROP TABLE doc_metadata;' +
        ' ALTER TABLE chunks DROP COLUMN heading_path;' +
        ' ALTER TABLE chunks DROP COLUMN start_line;' +
        ' ALTER TABLE chunks DROP COLUMN end_line;',
    );
    raw.close();

    const upgraded = VectorDB.open(dbPath, DIM);
    expect(upgraded.isDocsReindexRequired()).toBe(true);

    upgraded.insertDocument(
      '/docs/a.md',
      new Date(),
      [chunk('Install steps', { headingPath: ['Guide'], startLine: 3, endLine: 5 })],
      [VEC],
      meta({ tags: ['setup'] }),
    );
    const hit = upgraded.searchWithFilter(VEC, 5, null)[0];
    expect(hit?.headingPath).toEqual(['Guide']);
    expect(hit?.startLine).toBe(3);
    expect(hit?.endLine).toBe(5);
    expect(hit?.docMetadata?.tags).toEqual(['setup']);
    upgraded.close();
  });

  it('reopening an already-upgraded database does not set the flag again', () => {
    const dbPath = path.join(tmpDir, 'reopen.db');
    const first = VectorDB.open(dbPath, DIM);
    first.close();
    const second = VectorDB.open(dbPath, DIM);
    expect(second.isDocsReindexRequired()).toBe(false);
    second.close();
  });
});

describe('keyword search over titles and headings', () => {
  it('matches words that only appear in the document title or heading path', () => {
    const db = VectorDB.open(':memory:', DIM);
    db.insertDocument(
      '/docs/a.md',
      new Date(),
      [chunk('Run the installer now.', { headingPath: ['Guide', 'Installation'] })],
      [VEC],
      meta({ title: 'Deployment Handbook' }),
    );
    expect(db.searchByKeyword('Installation', 5, null)).toHaveLength(1);
    expect(db.searchByKeyword('Handbook', 5, null)).toHaveLength(1);
    expect(db.searchByKeyword('unrelated', 5, null)).toHaveLength(0);
    db.close();
  });
});

describe('insertDocument without metadata', () => {
  it('still works and returns results without document metadata or location', () => {
    const db = VectorDB.open(':memory:', DIM);
    db.insertDocument('/docs/plain.md', new Date(), [chunk('plain text')], [VEC]);
    const hit = db.searchWithFilter(VEC, 5, null)[0];
    expect(hit?.document).toBe('/docs/plain.md');
    expect(hit?.docMetadata).toBeUndefined();
    expect(hit?.headingPath).toBeUndefined();
    expect(hit?.startLine).toBeUndefined();
    db.close();
  });
});
