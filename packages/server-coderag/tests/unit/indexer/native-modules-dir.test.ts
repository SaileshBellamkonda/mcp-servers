import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeParser } from '../../../src/indexer/code-parser.ts';
import { Indexer } from '../../../src/indexer/indexer.ts';
import { Embedder } from '../../../src/embedder/embedder.ts';
import { VectorDB } from '../../../src/vectordb/db.ts';

describe('nativeModulesDir', () => {
  let dir: string;
  let source: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-native-'));
    const stub = path.join(dir, 'node_modules', 'tree-sitter');
    mkdirSync(stub, { recursive: true });
    writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'tree-sitter', main: 'index.js' }));
    writeFileSync(path.join(stub, 'index.js'), "throw new Error('stub-tree-sitter-used');\n");
    source = path.join(dir, 'sample.ts');
    writeFileSync(source, 'export function hello(): string { return "hi"; }\n');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('CodeParser resolves tree-sitter from the given directory', () => {
    expect(() => new CodeParser({ nativeModulesDir: dir })).toThrow(/stub-tree-sitter-used/);
  });

  it('CodeParser keeps the default resolution when the option is absent', () => {
    expect(new CodeParser().parseFile(source).length).toBeGreaterThan(0);
  });

  it('Indexer forwards the option to its code parser', async () => {
    const db = VectorDB.open(':memory:', 4);
    const embedder = new Embedder({ url: 'http://127.0.0.1:9', model: 'm', batchSize: 1 });
    const indexer = new Indexer(db, embedder, 500, { nativeModulesDir: dir });
    await expect(indexer.indexCodeFile(source)).rejects.toThrow(/stub-tree-sitter-used/);
    indexer.close();
    db.close();
  });
});
