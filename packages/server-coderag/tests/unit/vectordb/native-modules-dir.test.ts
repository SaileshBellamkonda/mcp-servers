import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VectorDB } from '../../../src/vectordb/db.ts';

describe('VectorDB.open nativeModulesDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-native-'));
    const stub = path.join(dir, 'node_modules', 'sqlite-vec');
    mkdirSync(stub, { recursive: true });
    writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'sqlite-vec', main: 'index.js' }));
    writeFileSync(path.join(stub, 'index.js'), "module.exports = { load() { throw new Error('stub-sqlite-vec-used'); } };\n");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads sqlite-vec from the given directory', () => {
    expect(() => VectorDB.open(':memory:', 4, { nativeModulesDir: dir })).toThrow(/stub-sqlite-vec-used/);
  });

  it('keeps the default resolution when the option is absent', () => {
    const db = VectorDB.open(':memory:', 4);
    expect(db.getStoredDimensions()).toBe(4);
    db.close();
  });
});
