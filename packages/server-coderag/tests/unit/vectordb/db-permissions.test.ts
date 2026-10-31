import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VectorDB } from '../../../src/vectordb/db.ts';

const posix = process.platform !== 'win32';
const mode = (p: string): number => statSync(p).mode & 0o777;

describe.skipIf(!posix)('database file and directory permissions (umask 022)', () => {
  let root: string;
  let previousUmask: number;

  beforeEach(() => {
    previousUmask = process.umask(0o022);
    root = mkdtempSync(path.join(tmpdir(), 'coderag-perm-'));
  });
  afterEach(() => {
    process.umask(previousUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it('creates missing parent directories 0700 and the new database file 0600', () => {
    const dir = path.join(root, 'a', 'b');
    const dbPath = path.join(dir, 'index.db');
    VectorDB.open(dbPath, 4).close();
    expect(mode(path.join(root, 'a'))).toBe(0o700);
    expect(mode(dir)).toBe(0o700);
    expect(mode(dbPath)).toBe(0o600);
  });

  it('keeps the WAL and shared-memory files private while the database is open', () => {
    const dbPath = path.join(root, 'index.db');
    const db = VectorDB.open(dbPath, 4);
    try {
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(dbPath + suffix)) expect(mode(dbPath + suffix)).toBe(0o600);
      }
    } finally {
      db.close();
    }
  });

  it('does not change the mode of an existing directory', () => {
    const dir = path.join(root, 'shared');
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    VectorDB.open(path.join(dir, 'index.db'), 4).close();
    expect(mode(dir)).toBe(0o755);
    expect(mode(path.join(dir, 'index.db'))).toBe(0o600);
  });

  it('does not change the mode of an existing database file', () => {
    const dbPath = path.join(root, 'index.db');
    VectorDB.open(dbPath, 4).close();
    chmodSync(dbPath, 0o644);
    VectorDB.open(dbPath, 4).close();
    expect(mode(dbPath)).toBe(0o644);
  });

  it('opens an existing empty file the user created without touching its mode', () => {
    const dbPath = path.join(root, 'pre.db');
    writeFileSync(dbPath, '', { mode: 0o640 });
    chmodSync(dbPath, 0o640);
    VectorDB.open(dbPath, 4).close();
    expect(mode(dbPath)).toBe(0o640);
  });
});
