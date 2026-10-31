import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openSqliteDatabase,
  loadSqliteVec,
  isNodeSqliteAvailable,
  type SqliteDatabase,
} from '../../../src/vectordb/sqlite-db.ts';

const open: SqliteDatabase[] = [];
function memory(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:');
  open.push(db);
  return db;
}
afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
});

describe('statements', () => {
  it('runs, gets and alls with positional parameters and normalises lastInsertRowid', () => {
    const db = memory();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, score REAL)');
    const ins = db.prepare('INSERT INTO t (name, score) VALUES (?, ?)');
    const first = ins.run('a', 1.5);
    const second = ins.run('b', 2);
    expect(first).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(second.lastInsertRowid).toBe(2);
    expect(typeof second.lastInsertRowid).toBe('number');
    expect(db.prepare('SELECT name, score FROM t WHERE id = ?').get(2)).toEqual({ name: 'b', score: 2 });
    expect(db.prepare('SELECT name FROM t WHERE id = ?').get(99)).toBeUndefined();
    expect(db.prepare('SELECT name FROM t ORDER BY id').all().map((r) => r['name'])).toEqual(['a', 'b']);
  });

  it('binds named parameters from an object', () => {
    const db = memory();
    db.exec('CREATE TABLE t (name TEXT, n INTEGER)');
    db.prepare('INSERT INTO t (name, n) VALUES (:name, :n)').run({ name: 'x', n: 7 });
    expect(db.prepare('SELECT n FROM t WHERE name = @name').get({ name: 'x' })).toEqual({ n: 7 });
  });

  it('converts undefined to NULL and booleans to 0/1', () => {
    const db = memory();
    db.exec('CREATE TABLE t (a TEXT, b INTEGER, c INTEGER)');
    db.prepare('INSERT INTO t VALUES (?, ?, ?)').run(undefined, true, false);
    expect(db.prepare('SELECT a, b, c FROM t').get()).toEqual({ a: null, b: 1, c: 0 });
  });

  it('binds integer-valued numbers as INTEGER and fractions as REAL', () => {
    const db = memory();
    expect(db.prepare('SELECT typeof(?) AS a, typeof(?) AS b, typeof(?) AS c').get(5, 5.5, 2 ** 40)).toEqual({
      a: 'integer',
      b: 'real',
      c: 'integer',
    });
    expect(db.prepare('SELECT 1 WHERE 1 LIMIT ?').all(3)).toHaveLength(1);
  });

  it('binds Buffers, Uint8Arrays and Float32Arrays as blobs with the same bytes', () => {
    const db = memory();
    db.exec('CREATE TABLE t (b BLOB)');
    const ins = db.prepare('INSERT INTO t VALUES (?)');
    ins.run(Buffer.from([1, 2, 3]));
    ins.run(new Uint8Array([4, 5]));
    ins.run(new Float32Array([1, 0.5]));
    const rows = db.prepare('SELECT b, length(b) AS len FROM t ORDER BY rowid').all();
    expect(rows.map((r) => r['len'])).toEqual([3, 2, 8]);
    const f = rows[2]?.['b'] as Uint8Array;
    expect([...new Float32Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength))]).toEqual([1, 0.5]);
  });

  it('reports changes for updates and deletes', () => {
    const db = memory();
    db.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2),(3)');
    expect(db.prepare('DELETE FROM t WHERE n > ?').run(1).changes).toBe(2);
  });

  it('reads typed rows through the Row generic', () => {
    const db = memory();
    const row = db.prepare<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM sqlite_master').get();
    expect(row?.cnt).toBe(0);
  });
});

describe('transaction', () => {
  function table(): SqliteDatabase {
    const db = memory();
    db.exec('CREATE TABLE t (n INTEGER)');
    return db;
  }
  const count = (db: SqliteDatabase): number => db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM t').get()?.c ?? -1;

  it('commits and returns the callback result, passing arguments through', () => {
    const db = table();
    const add = db.transaction((a: number, b: number) => {
      db.prepare('INSERT INTO t VALUES (?)').run(a);
      db.prepare('INSERT INTO t VALUES (?)').run(b);
      return a + b;
    });
    expect(add(2, 3)).toBe(5);
    expect(count(db)).toBe(2);
  });

  it('rolls back and rethrows the original error', () => {
    const db = table();
    const boom = new Error('boom');
    const run = db.transaction(() => {
      db.prepare('INSERT INTO t VALUES (1)').run();
      throw boom;
    });
    expect(() => run()).toThrow(boom);
    expect(count(db)).toBe(0);
    // the connection is usable (no dangling transaction)
    db.transaction(() => db.prepare('INSERT INTO t VALUES (2)').run())();
    expect(count(db)).toBe(1);
  });

  it('supports nesting: an inner failure rolls back only the inner work when caught', () => {
    const db = table();
    const inner = db.transaction(() => {
      db.prepare('INSERT INTO t VALUES (2)').run();
      throw new Error('inner');
    });
    db.transaction(() => {
      db.prepare('INSERT INTO t VALUES (1)').run();
      try {
        inner();
      } catch {
        /* swallowed */
      }
    })();
    expect(db.prepare('SELECT n FROM t').all().map((r) => r['n'])).toEqual([1]);
  });

  it('rolls everything back when the outer transaction fails after a successful inner one', () => {
    const db = table();
    const inner = db.transaction(() => db.prepare('INSERT INTO t VALUES (2)').run());
    expect(() =>
      db.transaction(() => {
        inner();
        throw new Error('outer');
      })(),
    ).toThrow('outer');
    expect(count(db)).toBe(0);
  });
});

describe('pragma, readonly and lifecycle', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('applies pragmas and returns their rows', () => {
    const db = memory();
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
  });

  it('switches a file database to WAL and opens it read-only', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'coderag-sqlite-'));
    const file = path.join(dir, 'a.db');
    const db = openSqliteDatabase(file);
    expect(db.pragma('journal_mode = WAL')).toEqual([{ journal_mode: 'wal' }]);
    db.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1)');
    db.close();
    const ro = openSqliteDatabase(file, { readonly: true });
    expect(ro.prepare('SELECT n FROM t').get()).toEqual({ n: 1 });
    expect(() => ro.exec('INSERT INTO t VALUES (2)')).toThrow(/readonly/i);
    ro.close();
  });

  it('throws on use after close', () => {
    const db = memory();
    db.close();
    expect(() => db.exec('SELECT 1')).toThrow();
  });
});

describe('sqlite-vec', () => {
  it('loads as an extension and rowid inserts work with numbers returned by lastInsertRowid', () => {
    const db = openSqliteDatabase(':memory:', { allowExtension: true });
    open.push(db);
    loadSqliteVec(db, undefined);
    expect(db.prepare<{ v: string }>('SELECT vec_version() AS v').get()?.v).toMatch(/^v?\d/);
    db.exec('CREATE VIRTUAL TABLE v USING vec0(embedding FLOAT[2])');
    db.exec('CREATE TABLE c (id INTEGER PRIMARY KEY AUTOINCREMENT)');
    const id = db.prepare('INSERT INTO c DEFAULT VALUES').run().lastInsertRowid;
    db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)').run(id, new Float32Array([1, 0]));
    db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)').run(BigInt(id) + 1n, new Float32Array([0, 1]));
    const hits = db
      .prepare('SELECT rowid, distance FROM v WHERE embedding MATCH ? AND k = 2 ORDER BY distance')
      .all(new Float32Array([1, 0.1]));
    expect(hits.map((h) => h['rowid'])).toEqual([1, 2]);
  });

  it('wraps load failures with a clear message', () => {
    const db = memory();
    expect(() => loadSqliteVec(db, '/nonexistent-dir-for-sqlite-vec')).toThrow(/Failed to load sqlite-vec extension/);
  });
});

describe('isNodeSqliteAvailable', () => {
  it('is true on a supported runtime', () => {
    expect(isNodeSqliteAvailable()).toBe(true);
  });

  it('never throws: false when the loader throws or returns nothing', () => {
    expect(
      isNodeSqliteAvailable(() => {
        throw new Error('no sqlite');
      }),
    ).toBe(false);
    expect(isNodeSqliteAvailable(() => undefined)).toBe(false);
  });
});
