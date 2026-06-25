import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { Indexer } from '../../../src/indexer/indexer.js';
import { VectorDB } from '../../../src/vectordb/db.js';
import { Embedder } from '../../../src/embedder/embedder.js';
import type { EmbeddingConfig } from '../../../src/core/types.js';
import { GlobMatcher } from '../../../src/core/glob-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-indexer-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

function makeBatchEmbedder(dim: number): Embedder {
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.input.map((_t, i) => ({ index: i, embedding: Array(dim).fill(0.1) })),
      }),
    } as Response;
  });
  return new Embedder(embeddingConfig, mockFetch);
}

let db: VectorDB;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', DIM);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Indexer.indexFile (markdown)', () => {
  it('indexes a markdown file and stores chunks in DB', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    writeFileSync(filePath, '# Hello\n\nThis is a test document.\n\nWith multiple paragraphs.');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await indexer.indexFile(filePath);
    const docs = db.listDocuments();
    expect(docs.has(filePath)).toBe(true);
  });

  it('handles empty file without throwing', async () => {
    const filePath = path.join(tmpDir, 'empty.md');
    writeFileSync(filePath, '');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await expect(indexer.indexFile(filePath)).resolves.not.toThrow();
  });
});

describe('Indexer.indexCodeFile', () => {
  it('indexes a TypeScript file and stores code chunks', async () => {
    const filePath = path.join(tmpDir, 'app.ts');
    writeFileSync(filePath, 'export function hello(): string { return "hi"; }');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await indexer.indexCodeFile(filePath);
    const docs = db.listDocuments();
    expect(docs.has(filePath)).toBe(true);
  });
});

describe('Indexer.indexCodeDirectory', () => {
  it('indexes all supported files in a directory', async () => {
    writeFileSync(path.join(tmpDir, 'a.ts'), 'function a() {}');
    writeFileSync(path.join(tmpDir, 'b.py'), 'def b(): pass');
    writeFileSync(path.join(tmpDir, 'README.md'), 'ignore me');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(2);
  });

  it('skips unchanged files on second run', async () => {
    writeFileSync(path.join(tmpDir, 'c.ts'), 'function c() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await indexer.indexCodeDirectory(tmpDir, false);
    const result2 = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips hidden directories and node_modules', async () => {
    mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.git', 'config.ts'), 'function hidden() {}');
    writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.ts'), 'function pkg() {}');
    writeFileSync(path.join(tmpDir, 'visible.ts'), 'function visible() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1); // only visible.ts
  });

  it('does not throw for non-existent directory', async () => {
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await expect(indexer.indexCodeDirectory(path.join(tmpDir, 'noexist'), false)).resolves.not.toThrow();
  });

  it('excludes files matching glob pattern', async () => {
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function app() {}');
    writeFileSync(path.join(tmpDir, 'app.test.ts'), 'function testApp() {}');
    writeFileSync(path.join(tmpDir, 'util.ts'), 'function util() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexCodeDirectory(tmpDir, false, ['**/*.test.ts']);
    expect(result.indexed).toBe(2); // app.ts and util.ts, not app.test.ts
    expect(db.listDocuments().has(path.join(tmpDir, 'app.test.ts'))).toBe(false);
  });

  it('excludes a subdirectory by name', async () => {
    mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'main.ts'), 'function main() {}');
    writeFileSync(path.join(tmpDir, 'generated', 'auto.ts'), 'function auto() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexCodeDirectory(tmpDir, false, ['generated']);
    expect(result.indexed).toBe(1); // only main.ts
    expect(db.listDocuments().has(path.join(tmpDir, 'generated', 'auto.ts'))).toBe(false);
  });

  it('excludes subdirectory using glob with wildcard', async () => {
    mkdirSync(path.join(tmpDir, 'build'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src.ts'), 'function src() {}');
    writeFileSync(path.join(tmpDir, 'build', 'out.ts'), 'function out() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexCodeDirectory(tmpDir, false, ['build/**']);
    expect(result.indexed).toBe(1); // only src.ts
  });
});

describe('Indexer with globalExclude option', () => {
  it('applies global exclude to code directory indexing', async () => {
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function app() {}');
    writeFileSync(path.join(tmpDir, 'app.test.ts'), 'function testApp() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { globalExclude: ['**/*.test.ts'] });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().has(path.join(tmpDir, 'app.test.ts'))).toBe(false);
  });

  it('merges globalExclude with per-call exclude', async () => {
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function app() {}');
    writeFileSync(path.join(tmpDir, 'app.test.ts'), 'function testApp() {}');
    writeFileSync(path.join(tmpDir, 'util.ts'), 'function util() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { globalExclude: ['**/*.test.ts'] });
    const result = await indexer.indexCodeDirectory(tmpDir, false, ['util.ts']);
    expect(result.indexed).toBe(1); // only app.ts
    expect(db.listDocuments().has(path.join(tmpDir, 'app.test.ts'))).toBe(false);
    expect(db.listDocuments().has(path.join(tmpDir, 'util.ts'))).toBe(false);
  });

  it('applies global exclude to markdown directory indexing', async () => {
    writeFileSync(path.join(tmpDir, 'guide.md'), '# Guide\n\nContent.');
    writeFileSync(path.join(tmpDir, 'guide.draft.md'), '# Draft\n\nDraft.');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { globalExclude: ['**/*.draft.md'] });
    const result = await indexer.indexMarkdownDirectory(tmpDir, false);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().has(path.join(tmpDir, 'guide.draft.md'))).toBe(false);
  });
});

describe('Indexer with useGitignore option', () => {
  it('respects .gitignore patterns during code directory indexing', async () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored.ts\n');
    writeFileSync(path.join(tmpDir, 'visible.ts'), 'function visible() {}');
    writeFileSync(path.join(tmpDir, 'ignored.ts'), 'function ignored() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { useGitignore: true });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().has(path.join(tmpDir, 'ignored.ts'))).toBe(false);
  });

  it('respects .gitignore directory patterns', async () => {
    mkdirSync(path.join(tmpDir, 'build'), { recursive: true });
    writeFileSync(path.join(tmpDir, '.gitignore'), 'build/\n');
    writeFileSync(path.join(tmpDir, 'main.ts'), 'function main() {}');
    writeFileSync(path.join(tmpDir, 'build', 'out.ts'), 'function out() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { useGitignore: true });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1);
    expect(db.listDocuments().has(path.join(tmpDir, 'build', 'out.ts'))).toBe(false);
  });

  it('respects nested .gitignore files', async () => {
    mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'sub', '.gitignore'), 'secret.ts\n');
    writeFileSync(path.join(tmpDir, 'main.ts'), 'function main() {}');
    writeFileSync(path.join(tmpDir, 'sub', 'public.ts'), 'function pub() {}');
    writeFileSync(path.join(tmpDir, 'sub', 'secret.ts'), 'function secret() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { useGitignore: true });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(2); // main.ts + sub/public.ts
    expect(db.listDocuments().has(path.join(tmpDir, 'sub', 'secret.ts'))).toBe(false);
  });

  it('ignores .gitignore when useGitignore is false', async () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'visible.ts\n');
    writeFileSync(path.join(tmpDir, 'visible.ts'), 'function visible() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, { useGitignore: false });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1);
  });

  it('combines globalExclude and useGitignore', async () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'gitignored.ts\n');
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function app() {}');
    writeFileSync(path.join(tmpDir, 'gitignored.ts'), 'function git() {}');
    writeFileSync(path.join(tmpDir, 'excluded.ts'), 'function ex() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500, {
      globalExclude: ['excluded.ts'],
      useGitignore: true,
    });
    const result = await indexer.indexCodeDirectory(tmpDir, false);
    expect(result.indexed).toBe(1); // only app.ts
  });
});

describe('Indexer.indexMarkdownDirectory', () => {
  it('indexes only markdown files in a directory', async () => {
    writeFileSync(path.join(tmpDir, 'readme.md'), '# Readme\n\nSome content here.');
    writeFileSync(path.join(tmpDir, 'notes.md'), '# Notes\n\nMore content here.');
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function app() {}');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexMarkdownDirectory(tmpDir, false);
    expect(result.indexed).toBe(2); // only .md files
    expect(db.listDocuments().has(path.join(tmpDir, 'app.ts'))).toBe(false);
  });

  it('skips unchanged markdown files on second run', async () => {
    writeFileSync(path.join(tmpDir, 'doc.md'), '# Doc\n\nContent.');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await indexer.indexMarkdownDirectory(tmpDir, false);
    const result2 = await indexer.indexMarkdownDirectory(tmpDir, false);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
  });

  it('excludes markdown files matching a glob pattern', async () => {
    writeFileSync(path.join(tmpDir, 'guide.md'), '# Guide\n\nContent.');
    writeFileSync(path.join(tmpDir, 'guide.draft.md'), '# Draft\n\nDraft content.');
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    const result = await indexer.indexMarkdownDirectory(tmpDir, false, ['**/*.draft.md']);
    expect(result.indexed).toBe(1); // only guide.md
    expect(db.listDocuments().has(path.join(tmpDir, 'guide.draft.md'))).toBe(false);
  });

  it('does not throw for non-existent directory', async () => {
    const embedder = makeBatchEmbedder(DIM);
    const indexer = new Indexer(db, embedder, 500);
    await expect(indexer.indexMarkdownDirectory(path.join(tmpDir, 'noexist'), false)).resolves.not.toThrow();
  });
});

describe('Indexer.isDocExcluded', () => {
  it('returns false when no docsMatcher is configured', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500);
    expect(indexer.isDocExcluded('/any/file.md')).toBe(false);
  });

  it('returns true for a file excluded by docsMatcher', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      docsMatcher: new GlobMatcher(['**/*.md'], ['**/*.draft.md'], tmpDir),
    });
    expect(indexer.isDocExcluded(path.join(tmpDir, 'doc.draft.md'))).toBe(true);
  });

  it('returns false for a non-excluded file', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      docsMatcher: new GlobMatcher(['**/*.md'], ['**/*.draft.md'], tmpDir),
    });
    expect(indexer.isDocExcluded(path.join(tmpDir, 'guide.md'))).toBe(false);
  });
});

describe('Indexer.isCodeExcluded', () => {
  it('returns false when no codeMatcher is configured', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500);
    expect(indexer.isCodeExcluded('/any/file.ts')).toBe(false);
  });

  it('returns true for a file excluded by codeMatcher', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      codeMatcher: new GlobMatcher(['**/*.ts'], ['**/*.test.ts'], tmpDir),
    });
    expect(indexer.isCodeExcluded(path.join(tmpDir, 'app.test.ts'))).toBe(true);
  });

  it('returns false for a non-excluded file', () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      codeMatcher: new GlobMatcher(['**/*.ts'], ['**/*.test.ts'], tmpDir),
    });
    expect(indexer.isCodeExcluded(path.join(tmpDir, 'app.ts'))).toBe(false);
  });
});

describe('Indexer.scanDocs', () => {
  it('returns zero counts when no docsMatcher is set', async () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500);
    const result = await indexer.scanDocs();
    expect(result).toEqual({ indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 });
  });

  it('finds and indexes markdown files via docsMatcher', async () => {
    writeFileSync(path.join(tmpDir, 'guide.md'), '# Guide\n\nContent.');
    writeFileSync(path.join(tmpDir, 'app.ts'), 'function x() {}');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir),
    });
    const result = await indexer.scanDocs();
    expect(result.indexed).toBe(1);
    expect(db.listDocumentsByType('doc').size).toBe(1);
  });

  it('skips unchanged files on second scan', async () => {
    writeFileSync(path.join(tmpDir, 'stable.md'), '# Stable\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir),
    });
    await indexer.scanDocs();
    const result2 = await indexer.scanDocs();
    expect(result2.indexed).toBe(0);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
  });

  it('re-indexes all files when force = true', async () => {
    writeFileSync(path.join(tmpDir, 'doc.md'), '# Doc\n\nContent.');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/**/*.md`], [], tmpDir),
    });
    await indexer.scanDocs();
    const result2 = await indexer.scanDocs(true);
    expect(result2.indexed).toBe(1);
    expect(result2.skipped).toBe(0);
  });
});

describe('Indexer.scanCode', () => {
  it('returns zero counts when no codeMatcher is set', async () => {
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500);
    const result = await indexer.scanCode();
    expect(result).toEqual({ indexed: 0, skipped: 0, failed: 0, added: 0, updated: 0 });
  });

  it('finds and indexes TypeScript files via codeMatcher', async () => {
    writeFileSync(path.join(tmpDir, 'fn.ts'), 'export function fn() { return 1; }');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      codeMatcher: new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir),
    });
    const result = await indexer.scanCode();
    expect(result.indexed).toBe(1);
    expect(db.listDocumentsByType('code').size).toBe(1);
  });

  it('skips unchanged files on second scan', async () => {
    writeFileSync(path.join(tmpDir, 'fn.ts'), 'export function fn() {}');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      codeMatcher: new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir),
    });
    await indexer.scanCode();
    const result2 = await indexer.scanCode();
    expect(result2.indexed).toBe(0);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);
  });

  it('re-indexes all files when force = true', async () => {
    writeFileSync(path.join(tmpDir, 'fn2.ts'), 'export function fn2() {}');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeBatchEmbedder(DIM), 500, {
      codeMatcher: new GlobMatcher([`${tmpFwd}/**/*.ts`], [], tmpDir),
    });
    await indexer.scanCode();
    const result2 = await indexer.scanCode(true);
    expect(result2.indexed).toBe(1);
    expect(result2.skipped).toBe(0);
  });
});
