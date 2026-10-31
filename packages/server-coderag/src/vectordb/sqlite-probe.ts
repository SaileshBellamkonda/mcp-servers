import { SqliteDatabase, loadSqliteVec, type NodeSqliteModule } from './sqlite-db.ts';

/** Oldest Node.js with a `node:sqlite` coderag can use (tree-sitter also crashes on 22.13). */
const MIN_NODE = { major: 22, minor: 14 };

export type SqliteProbeResult =
  | { ok: true }
  | {
      ok: false;
      /** Human-readable cause, safe to show to users. */
      reason: string;
      /**
       * Set when one known remedy applies: `'fts5'` = only keyword search is missing (vector search works; needs
       * Node.js >= 22.16 / VS Code >= 1.103); `'node'` = Node.js is too old or has no `node:sqlite`.
       */
      needs?: 'fts5' | 'node';
    };

export interface SqliteProbeDeps {
  /** Defaults to `process.versions.node`. */
  nodeVersion?: string | undefined;
  /** Defaults to `process.getBuiltinModule('node:sqlite')`. */
  loadNodeSqlite?: (() => NodeSqliteModule | undefined) | undefined;
  /** Defaults to the real sqlite-vec loader. */
  loadSqliteVec?: ((db: SqliteDatabase) => void) | undefined;
  /** Where to find `node_modules/sqlite-vec` for bundled builds. */
  nativeModulesDir?: string | undefined;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nodeIsSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

/**
 * Checks, in order, that this runtime can run coderag's database layer: Node >= 22.14, `node:sqlite` loads,
 * a database can be opened with extensions allowed, sqlite-vec loads and answers `vec_version()`, a vec0 table
 * works, and FTS5 exists. Never throws; every failure becomes `{ ok: false, reason }`
 * (`needs: 'fts5'` when only keyword search is unavailable).
 */
export function probeSqliteSupport(deps: SqliteProbeDeps = {}): SqliteProbeResult {
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  if (!nodeIsSupported(nodeVersion)) {
    return { ok: false, reason: `Node.js ${nodeVersion} is too old; coderag needs Node.js >= ${String(MIN_NODE.major)}.${String(MIN_NODE.minor)}`, needs: 'node' };
  }

  let sqlite: NodeSqliteModule | undefined;
  try {
    sqlite = (deps.loadNodeSqlite ?? ((): NodeSqliteModule | undefined => process.getBuiltinModule('node:sqlite')))();
  } catch (err) {
    return { ok: false, reason: `node:sqlite failed to load: ${describe(err)}`, needs: 'node' };
  }
  if (!sqlite) return { ok: false, reason: 'node:sqlite is not available in this runtime', needs: 'node' };

  let db: SqliteDatabase | undefined;
  try {
    try {
      db = new SqliteDatabase(new sqlite.DatabaseSync(':memory:', { allowExtension: true }));
    } catch (err) {
      return { ok: false, reason: `node:sqlite could not open a database with extensions enabled: ${describe(err)}` };
    }

    try {
      (deps.loadSqliteVec ?? ((d: SqliteDatabase): void => { loadSqliteVec(d, deps.nativeModulesDir); }))(db);
      db.prepare('SELECT vec_version() AS v').get();
    } catch (err) {
      return { ok: false, reason: `sqlite-vec is unavailable (load or vec_version() failed): ${describe(err)}` };
    }

    try {
      db.exec('CREATE VIRTUAL TABLE temp.coderag_probe_vec USING vec0(embedding FLOAT[2])');
      db.prepare('INSERT INTO coderag_probe_vec (rowid, embedding) VALUES (?, ?)').run(1, new Float32Array([1, 0]));
      const hit = db
        .prepare('SELECT rowid FROM coderag_probe_vec WHERE embedding MATCH ? AND k = 1')
        .get(new Float32Array([1, 0]));
      if (!hit) throw new Error('KNN query returned no rows');
    } catch (err) {
      return { ok: false, reason: `sqlite-vec vec0 smoke test failed: ${describe(err)}` };
    }

    try {
      db.exec('CREATE VIRTUAL TABLE temp.coderag_probe_fts USING fts5(content)');
    } catch (err) {
      return { ok: false, reason: `SQLite FTS5 is unavailable (needs Node.js >= 22.16 / VS Code >= 1.103): ${describe(err)}`, needs: 'fts5' };
    }
    return { ok: true };
  } finally {
    try {
      db?.close();
    } catch {
      /* probe must never throw */
    }
  }
}
