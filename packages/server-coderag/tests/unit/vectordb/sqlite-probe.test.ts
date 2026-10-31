import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { probeSqliteSupport } from '../../../src/vectordb/sqlite-probe.ts';
import type { NodeSqliteModule } from '../../../src/vectordb/sqlite-db.ts';

/** A node:sqlite module whose databases throw when a statement matches `failOn`. */
function moduleFailing(failOn: RegExp, message: string): NodeSqliteModule {
  class Failing extends DatabaseSync {
    override exec(sql: string): void {
      if (failOn.test(sql)) throw new Error(message);
      super.exec(sql);
    }
  }
  return { DatabaseSync: Failing } as unknown as NodeSqliteModule;
}

describe('probeSqliteSupport', () => {
  it('passes on this runtime', () => {
    expect(probeSqliteSupport()).toEqual({ ok: true });
  });

  it('rejects Node older than 22.14 before touching sqlite', () => {
    let loaded = false;
    const result = probeSqliteSupport({
      nodeVersion: '22.13.0',
      loadNodeSqlite: () => {
        loaded = true;
        return undefined;
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/22\.14/);
    expect(result.ok === false && result.needs).toBe('node');
    expect(loaded).toBe(false);
  });

  it('accepts newer major versions and 22.14 itself', () => {
    expect(probeSqliteSupport({ nodeVersion: '22.14.0' })).toEqual({ ok: true });
    expect(probeSqliteSupport({ nodeVersion: '25.0.0' })).toEqual({ ok: true });
  });

  it('reports a missing node:sqlite module', () => {
    const result = probeSqliteSupport({ loadNodeSqlite: () => undefined });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/node:sqlite/);
    expect(result.ok === false && result.needs).toBe('node');
  });

  it('reports a loader that throws, without throwing itself', () => {
    const result = probeSqliteSupport({
      loadNodeSqlite: () => {
        throw new Error('boom-load');
      },
    });
    expect(result.ok === false && result.reason).toMatch(/boom-load/);
    expect(result.ok === false && result.needs).toBe('node');
  });

  it('reports a database that cannot be opened with extensions allowed', () => {
    const broken = {
      DatabaseSync: class {
        constructor() {
          throw new Error('boom-open');
        }
      },
    } as unknown as NodeSqliteModule;
    const result = probeSqliteSupport({ loadNodeSqlite: () => broken });
    expect(result.ok === false && result.reason).toMatch(/boom-open/);
  });

  it('reports sqlite-vec failing to load', () => {
    const result = probeSqliteSupport({
      loadSqliteVec: () => {
        throw new Error('Failed to load sqlite-vec extension: boom-vec');
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/boom-vec/);
    expect(result.ok === false && result.needs).toBeUndefined();
  });

  it('reports sqlite-vec that loads but does not answer vec_version()', () => {
    const result = probeSqliteSupport({ loadSqliteVec: () => undefined });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/vec_version/);
  });

  it('reports a failing vec0 smoke test', () => {
    const result = probeSqliteSupport({ loadNodeSqlite: () => moduleFailing(/vec0/i, 'boom-vec0') });
    expect(result.ok === false && result.reason).toMatch(/vec0.*boom-vec0/s);
    expect(result.ok === false && result.needs).toBeUndefined();
  });

  it('flags missing FTS5 separately so callers can fall back', () => {
    const result = probeSqliteSupport({ loadNodeSqlite: () => moduleFailing(/fts5/i, 'no such module: fts5') });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/FTS5.*no such module: fts5/s) as string, needs: 'fts5' });
  });
});
