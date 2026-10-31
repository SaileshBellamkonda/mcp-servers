import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { MarkdownLoader, splitFrontmatter } from '../../../src/indexer/loaders/markdown.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';
import { syncDocuments } from '../../../src/indexer/sync.ts';

const DIM = 4;

function oversizedFrontmatterDoc(): string {
  return `---\n${'k: v\n'.repeat(20000)}---\n# Title\n\nbody text\n`;
}

function fakeEmbedder(): Embedder {
  const fetchMock = vi.fn().mockImplementation(async (_url, opts) => {
    const body = JSON.parse((opts as RequestInit).body as string) as { input: string[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((_t, i) => ({ index: i, embedding: Array(DIM).fill(0.1) })) }),
    } as Response;
  });
  return new Embedder({ url: 'http://x', model: 'm', batchSize: 100 }, fetchMock);
}

describe('logging without stderr', () => {
  let dir: string;
  let db: VectorDB;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-indexer-logging-'));
    db = VectorDB.open(':memory:', DIM);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('splitFrontmatter and MarkdownLoader report an oversized frontmatter block as a warning, not on stderr', () => {
    const split = splitFrontmatter(oversizedFrontmatterDoc());
    expect(split.warning).toMatch(/64 KB/);

    const doc = new MarkdownLoader().load('/x/big.md', oversizedFrontmatterDoc());
    expect(doc.warnings?.[0]).toMatch(/64 KB/);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('a well-formed document carries no warnings', () => {
    expect(new MarkdownLoader().load('/x/ok.md', '---\ntitle: T\n---\n# T\n\ntext\n').warnings ?? []).toEqual([]);
  });

  it('the Indexer logs loader warnings through its logger', async () => {
    const file = path.join(dir, 'big.md');
    writeFileSync(file, oversizedFrontmatterDoc());
    const logger = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const indexer = new Indexer(db, fakeEmbedder(), 500, { logger });

    await indexer.indexFile(file);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringMatching(/big\.md.*64 KB|64 KB.*big\.md/s));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('the Indexer without a logger stays silent', async () => {
    const file = path.join(dir, 'plain.md');
    writeFileSync(file, '# Plain\n\nsome content\n');
    const indexer = new Indexer(db, fakeEmbedder(), 500);

    await indexer.indexFile(file);

    expect(stderr).not.toHaveBeenCalled();
  });

  it('syncDocuments without a logger stays silent', async () => {
    const docs = path.join(dir, 'docs');
    mkdirSync(docs);
    writeFileSync(path.join(docs, 'a.md'), '# A\n\ncontent\n');
    const indexer = new Indexer(db, fakeEmbedder(), 500);

    await syncDocuments([docs], db, indexer);

    expect(stderr).not.toHaveBeenCalled();
  });

  describe('grammar loading', () => {
    let nativeDir: string;

    beforeEach(() => {
      // A tree-sitter stub that rejects every grammar, so each language fails to initialise.
      nativeDir = path.join(dir, 'native');
      const stub = path.join(nativeDir, 'node_modules', 'tree-sitter');
      mkdirSync(stub, { recursive: true });
      writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'tree-sitter', main: 'index.js' }));
      writeFileSync(path.join(stub, 'index.js'), "class Parser { setLanguage() { throw new Error('stub rejects grammar'); } }\nParser.Query = class Query {};\nmodule.exports = Parser;\n");
    });

    it('CodeParser reports each grammar that fails to load to the warn callback, not stderr', () => {
      const warn = vi.fn();
      new CodeParser({ nativeModulesDir: nativeDir, warn });

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Failed to load tree-sitter grammar for typescript.*stub rejects grammar/s));
      expect(stderr).not.toHaveBeenCalled();
    });

    it('CodeParser without a warn callback stays silent', () => {
      new CodeParser({ nativeModulesDir: nativeDir });
      expect(stderr).not.toHaveBeenCalled();
    });

    it('the Indexer routes grammar warnings to its logger', async () => {
      const file = path.join(dir, 'a.ts');
      writeFileSync(file, 'export const a = 1;\n');
      const logger = { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
      const indexer = new Indexer(db, fakeEmbedder(), 500, { logger, nativeModulesDir: nativeDir });

      await indexer.indexCodeFile(file).catch(() => undefined);

      expect(logger.warning).toHaveBeenCalledWith(expect.stringMatching(/Failed to load tree-sitter grammar for/));
      expect(stderr).not.toHaveBeenCalled();
    });
  });
});
