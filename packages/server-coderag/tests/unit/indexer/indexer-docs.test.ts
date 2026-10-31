import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { LoaderRegistry } from '../../../src/indexer/loaders/registry.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { GlobMatcher } from '../../../src/core/glob-utils.ts';
import type { EmbeddingConfig } from '../../../src/core/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '../../../.tmp-indexer-docs-test');

const DIM = 4;
const embeddingConfig: EmbeddingConfig = { url: 'http://x', model: 'test', batchSize: 100 };

function makeCapturingEmbedder(inputs: string[]): Embedder {
  const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    inputs.push(...body.input);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })),
      }),
    } as Response;
  });
  return new Embedder(embeddingConfig, mockFetch);
}

const MDX_SOURCE = [
  '---',
  'title: Install Guide',
  'tags: [setup, Linux]',
  'doc_type: guide',
  '---',
  "import Foo from './foo'",
  '',
  '# Guide',
  '',
  '## Install',
  '',
  'Run the installer.',
].join('\n');

let db: VectorDB;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  db = VectorDB.open(':memory:', DIM);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Indexer document loading', () => {
  it('indexes an .mdx file and stores heading path, line numbers and frontmatter metadata', async () => {
    const filePath = path.join(tmpDir, 'install.mdx');
    writeFileSync(filePath, MDX_SOURCE);
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500);

    await indexer.indexFile(filePath);

    const hit = db.searchByKeyword('installer', 5, null)[0];
    expect(hit?.document).toBe(filePath);
    expect(hit?.headingPath).toEqual(['Guide', 'Install']);
    expect(hit?.startLine).toBe(10);
    expect(hit?.endLine).toBe(12);
    expect(hit?.docMetadata?.title).toBe('Install Guide');
    expect(hit?.docMetadata?.tags).toEqual(['linux', 'setup']);
    expect(hit?.docMetadata?.docType).toBe('guide');
  });

  it('embeds title, breadcrumb and tags with the chunk but stores only the chunk content', async () => {
    const filePath = path.join(tmpDir, 'install.mdx');
    writeFileSync(filePath, MDX_SOURCE);
    const inputs: string[] = [];
    const indexer = new Indexer(db, makeCapturingEmbedder(inputs), 500);

    await indexer.indexFile(filePath);

    expect(inputs).toEqual([
      'Install Guide\nGuide > Install\ntags: setup, linux\n\n## Install\n\nRun the installer.',
    ]);
    expect(db.searchByKeyword('installer', 5, null)[0]?.chunk).toBe('## Install\n\nRun the installer.');
  });

  it('indexes markdown without frontmatter, using the first H1 as the title', async () => {
    const filePath = path.join(tmpDir, 'plain.md');
    writeFileSync(filePath, '# Plain Title\n\nSome plain content here.');
    const inputs: string[] = [];
    const indexer = new Indexer(db, makeCapturingEmbedder(inputs), 500);

    await indexer.indexFile(filePath);

    expect(inputs).toEqual(['Plain Title\nPlain Title\n\n# Plain Title\n\nSome plain content here.']);
    expect(db.searchByKeyword('plain', 5, null)[0]?.docMetadata?.title).toBe('Plain Title');
  });

  it('throws for a file type no loader handles', async () => {
    const filePath = path.join(tmpDir, 'notes.txt');
    writeFileSync(filePath, 'text');
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500);
    await expect(indexer.indexFile(filePath)).rejects.toThrow('Unsupported document type');
  });

  it('isDocumentFile recognises md, markdown and mdx only', () => {
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500);
    expect(indexer.isDocumentFile('/x/a.md')).toBe(true);
    expect(indexer.isDocumentFile('/x/a.markdown')).toBe(true);
    expect(indexer.isDocumentFile('/x/a.MDX')).toBe(true);
    expect(indexer.isDocumentFile('/x/a.png')).toBe(false);
    expect(indexer.isDocumentFile('/x/a.ts')).toBe(false);
  });

  it('scanDocs skips files that no loader supports', async () => {
    writeFileSync(path.join(tmpDir, 'notes.md'), '# Notes\n\nSome notes.');
    writeFileSync(path.join(tmpDir, 'logo.png'), 'not really a png');
    const tmpFwd = tmpDir.replace(/\\/g, '/');
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500, {
      docsMatcher: new GlobMatcher([`${tmpFwd}/**/*`], [], tmpDir),
    });

    const result = await indexer.scanDocs(false);

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
    expect([...db.listDocuments().keys()].map((f) => path.basename(f))).toEqual(['notes.md']);
  });

  it('indexMarkdownDirectory also indexes .mdx and ignores other files', async () => {
    writeFileSync(path.join(tmpDir, 'a.md'), '# A\n\nalpha');
    writeFileSync(path.join(tmpDir, 'b.mdx'), '# B\n\nbeta');
    writeFileSync(path.join(tmpDir, 'c.txt'), 'gamma');
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500);

    const result = await indexer.indexMarkdownDirectory(tmpDir, false);

    expect(result.indexed).toBe(2);
    expect([...db.listDocuments().keys()].map((f) => path.basename(f)).sort()).toEqual(['a.md', 'b.mdx']);
  });

  it('uses a custom loader registry when one is supplied', async () => {
    const registry = new LoaderRegistry();
    registry.register({
      name: 'text',
      extensions: ['.txt'],
      load: (_filePath, source) => ({
        metadata: { title: 'Plain Text', tags: [], extra: {} },
        sections: [{ headingPath: [], text: source, startLine: 1, endLine: 1 }],
      }),
    });
    const filePath = path.join(tmpDir, 'notes.txt');
    writeFileSync(filePath, 'custom loader content');
    const indexer = new Indexer(db, makeCapturingEmbedder([]), 500, { loaders: registry });

    await indexer.indexFile(filePath);

    expect(db.listDocuments().has(filePath)).toBe(true);
    expect(indexer.isDocumentFile('/x/a.txt')).toBe(true);
    expect(indexer.isDocumentFile('/x/a.md')).toBe(false);
  });
});
