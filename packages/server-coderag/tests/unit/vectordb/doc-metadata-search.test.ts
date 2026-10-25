import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from '../../../src/vectordb/db.js';
import type { CodeChunk, DocumentMetadata, MarkdownChunk, SearchResult } from '../../../src/core/types.js';

const DIM = 4;
const VEC_AUTH = [0.9, 0.1, 0.1, 0.1];
const VEC_UI = [0.1, 0.9, 0.1, 0.1];
const VEC_PLAIN = [0.5, 0.5, 0.1, 0.1];
const VEC_CODE = [0.7, 0.7, 0.1, 0.1];

function meta(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return { title: 'Doc', tags: [], extra: {}, ...overrides };
}

function chunk(content: string, extra: Partial<MarkdownChunk> = {}): MarkdownChunk {
  return { content, position: 0, ...extra };
}

function codeChunk(): CodeChunk {
  return {
    content: 'function auth() {}',
    position: 0,
    symbolName: 'auth',
    symbolType: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    parentSymbol: '',
    signature: 'function auth()',
  };
}

function docs(results: SearchResult[]): string[] {
  return results.map((r) => r.document).sort();
}

let db: VectorDB;

beforeEach(() => {
  db = VectorDB.open(':memory:', DIM);
  db.insertDocument(
    '/docs/auth.md',
    new Date(),
    [chunk('Authentication guide for OAuth2', { headingPath: ['Auth', 'OAuth2'], startLine: 3, endLine: 9 })],
    [VEC_AUTH],
    meta({ title: 'Auth Guide', tags: ['auth', 'security'], docType: 'guide', domain: 'backend', project: 'acme' }),
  );
  db.insertDocument(
    '/docs/ui.md',
    new Date(),
    [chunk('Button styling guide')],
    [VEC_UI],
    meta({ title: 'UI', tags: ['ui', 'security'], docType: 'spec', domain: 'frontend', project: 'zen' }),
  );
  db.insertDocument('/docs/plain.md', new Date(), [chunk('Plain document about authentication')], [VEC_PLAIN]);
  db.insertCodeDocument('/src/app.ts', new Date(), [codeChunk()], [VEC_CODE]);
});

afterEach(() => {
  db.close();
});

describe('result fields', () => {
  const expectedMeta = {
    title: 'Auth Guide',
    tags: ['auth', 'security'],
    docType: 'guide',
    domain: 'backend',
    project: 'acme',
  };

  it('semantic search returns heading path, lines and document metadata', () => {
    const hit = db.searchWithFilter(VEC_AUTH, 5, null)[0];
    expect(hit?.document).toBe('/docs/auth.md');
    expect(hit?.headingPath).toEqual(['Auth', 'OAuth2']);
    expect(hit?.startLine).toBe(3);
    expect(hit?.endLine).toBe(9);
    expect(hit?.docMetadata).toEqual(expectedMeta);
  });

  it('keyword search returns the same fields', () => {
    const hit = db.searchByKeyword('OAuth2', 5, null)[0];
    expect(hit?.document).toBe('/docs/auth.md');
    expect(hit?.headingPath).toEqual(['Auth', 'OAuth2']);
    expect(hit?.docMetadata).toEqual(expectedMeta);
  });

  it('hybrid search passes the fields through', () => {
    const hit = db.searchHybrid(VEC_AUTH, 'OAuth2', 5, null)[0];
    expect(hit?.document).toBe('/docs/auth.md');
    expect(hit?.docMetadata?.title).toBe('Auth Guide');
    expect(hit?.headingPath).toEqual(['Auth', 'OAuth2']);
  });

  it('code results keep their code metadata and have no document metadata', () => {
    const hit = db.searchWithFilter(VEC_CODE, 1, null)[0];
    expect(hit?.document).toBe('/src/app.ts');
    expect(hit?.metadata?.symbolName).toBe('auth');
    expect(hit?.docMetadata).toBeUndefined();
  });
});

describe('metadata filters', () => {
  it('requires every requested tag', () => {
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { tags: ['security'] }))).toEqual(['/docs/auth.md', '/docs/ui.md']);
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { tags: ['security', 'auth'] }))).toEqual(['/docs/auth.md']);
  });

  it('matches tags case-insensitively', () => {
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { tags: ['AUTH'] }))).toEqual(['/docs/auth.md']);
  });

  it('filters by doc type, domain and project case-insensitively', () => {
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { docType: 'GUIDE' }))).toEqual(['/docs/auth.md']);
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { domain: 'Frontend' }))).toEqual(['/docs/ui.md']);
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { project: 'ACME' }))).toEqual(['/docs/auth.md']);
  });

  it('excludes documents without metadata and code files whenever a metadata filter is set', () => {
    const found = docs(db.searchWithFilter(VEC_AUTH, 10, { tags: ['security'] }));
    expect(found).not.toContain('/docs/plain.md');
    expect(found).not.toContain('/src/app.ts');
  });

  it('applies the filters to keyword search', () => {
    expect(docs(db.searchByKeyword('guide', 10, { tags: ['ui'] }))).toEqual(['/docs/ui.md']);
  });

  it('applies the filters to hybrid search', () => {
    expect(docs(db.searchHybrid(VEC_UI, 'guide', 10, { docType: 'spec' }))).toEqual(['/docs/ui.md']);
  });

  it('combines metadata filters with the directory filter', () => {
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { directory: '/docs', tags: ['security'] }))).toEqual([
      '/docs/auth.md',
      '/docs/ui.md',
    ]);
    expect(db.searchWithFilter(VEC_AUTH, 10, { directory: '/src', tags: ['security'] })).toEqual([]);
  });

  it('does not filter when no filter field is set', () => {
    expect(db.searchWithFilter(VEC_AUTH, 10, {}).length).toBe(4);
  });
});

describe('re-indexing a document', () => {
  it('replaces its tags and metadata without leaving duplicates', () => {
    db.insertDocument(
      '/docs/auth.md',
      new Date(),
      [chunk('Authentication guide for OAuth2', { headingPath: ['Auth'] })],
      [VEC_AUTH],
      meta({ title: 'Auth v2', tags: ['oauth'], docType: 'guide' }),
    );

    expect(db.searchWithFilter(VEC_AUTH, 10, { tags: ['auth'] })).toEqual([]);
    const byNewTag = db.searchWithFilter(VEC_AUTH, 10, { tags: ['oauth'] });
    expect(byNewTag).toHaveLength(1);
    expect(byNewTag[0]?.docMetadata?.title).toBe('Auth v2');
    expect(byNewTag[0]?.docMetadata?.tags).toEqual(['oauth']);
    expect(docs(db.searchWithFilter(VEC_AUTH, 10, { tags: ['security'] }))).toEqual(['/docs/ui.md']);
  });
});
