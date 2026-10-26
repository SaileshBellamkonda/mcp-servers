import { describe, it, expect } from 'vitest';
import { probeCodeRagSupport } from '../../../src/embedded.js';

describe('probeCodeRagSupport (the capability probe the VS Code extension runs before starting CodeRAG)', () => {
  it('passes on this runtime: sqlite, sqlite-vec, FTS5 and tree-sitter with a grammar', () => {
    expect(probeCodeRagSupport()).toEqual({ ok: true });
  });

  it('returns the SQLite failure unchanged, including needs: fts5, and does not touch tree-sitter', () => {
    let parserCreated = false;
    const result = probeCodeRagSupport(
      {},
      {
        probeSqlite: () => ({ ok: false, reason: 'SQLite FTS5 is unavailable', needs: 'fts5' }),
        createParser: () => {
          parserCreated = true;
        },
      },
    );
    expect(result).toEqual({ ok: false, reason: 'SQLite FTS5 is unavailable', needs: 'fts5' });
    expect(parserCreated).toBe(false);
  });

  it('reports a tree-sitter load failure as a reason (never throws)', () => {
    const result = probeCodeRagSupport(
      { nativeModulesDir: '/nowhere' },
      {
        probeSqlite: () => ({ ok: true }),
        createParser: () => {
          throw new Error("Cannot find module 'tree-sitter'");
        },
      },
    );
    expect(result).toEqual({ ok: false, reason: "tree-sitter is unavailable: Cannot find module 'tree-sitter'" });
  });

  it('passes nativeModulesDir to both probes', () => {
    const seen: (string | undefined)[] = [];
    probeCodeRagSupport(
      { nativeModulesDir: '/bundle/native' },
      {
        probeSqlite: (deps) => {
          seen.push(deps?.nativeModulesDir);
          return { ok: true };
        },
        createParser: (dir) => {
          seen.push(dir);
        },
      },
    );
    expect(seen).toEqual(['/bundle/native', '/bundle/native']);
  });
});
