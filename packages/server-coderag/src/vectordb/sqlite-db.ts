import { createRequire } from 'node:module';
import path from 'node:path';
import type * as NodeSqlite from 'node:sqlite';

/**
 * Thin adapter over Node's built-in `node:sqlite` (`DatabaseSync`) giving the VectorDB the small
 * better-sqlite3-shaped surface it needs: `prepare().run/get/all`, `exec`, `transaction`, `pragma`, `close`.
 *
 * `node:sqlite` is loaded lazily (on the first open) so that merely importing this module never triggers
 * Node's "SQLite is an experimental feature" warning.
 */

export type NodeSqliteModule = typeof NodeSqlite;

/** Values accepted as statement parameters; the adapter converts them to what `node:sqlite` accepts. */
export type SqlParam = string | number | bigint | boolean | null | undefined | Uint8Array | Float32Array;
/** A named-parameter bag, bound by name (`:name`, `@name`, `$name`). */
export type SqlNamedParams = Record<string, SqlParam>;
/** A raw result row. Use the `Row` generic of `prepare` for typed access. */
export type SqlRow = Record<string, NodeSqlite.SQLOutputValue>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface OpenSqliteOptions {
  readonly?: boolean | undefined;
  /** Required before an extension (sqlite-vec) can be loaded. */
  allowExtension?: boolean | undefined;
}

const defaultRequire = createRequire(import.meta.url);

let cachedModule: NodeSqliteModule | undefined;

/** Loads `node:sqlite` on first use. Throws when the runtime does not provide it. */
export function getNodeSqlite(): NodeSqliteModule {
  if (cachedModule) return cachedModule;
  const mod = loadBuiltinSqlite();
  if (!mod) throw new Error('node:sqlite is not available in this Node.js runtime (requires Node.js >= 22.16)');
  cachedModule = mod;
  return mod;
}

function loadBuiltinSqlite(): NodeSqliteModule | undefined {
  // getBuiltinModule returns undefined (rather than throwing) for modules a runtime does not ship.
  return process.getBuiltinModule('node:sqlite');
}

/** Capability check for `node:sqlite` itself; never throws. `loader` is injectable for tests. */
export function isNodeSqliteAvailable(loader: () => NodeSqliteModule | undefined = loadBuiltinSqlite): boolean {
  try {
    const mod = loader();
    return mod !== undefined && typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
}

function toSqlInput(value: SqlParam): NodeSqlite.SQLInputValue {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'boolean':
      return value ? 1n : 0n;
    case 'number':
      // node:sqlite binds every JS number as REAL; integer-valued numbers (ids, LIMIT, vec0 rowids) must be INTEGER.
      return Number.isSafeInteger(value) ? BigInt(value) : value;
    case 'string':
    case 'bigint':
      return value;
    default:
      return value instanceof Float32Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : value;
  }
}

function isNamedParams(arg: SqlParam | SqlNamedParams | undefined): arg is SqlNamedParams {
  return typeof arg === 'object' && arg !== null && !ArrayBuffer.isView(arg);
}

/**
 * Converts call arguments for `StatementSync`. A leading plain object is a named-parameter bag; node:sqlite's
 * overloads accept it first, so it is smuggled through the positional list type with a single narrow cast.
 */
function bind(params: (SqlParam | SqlNamedParams)[]): NodeSqlite.SQLInputValue[] {
  const [first, ...rest] = params;
  if (isNamedParams(first)) {
    const named: Record<string, NodeSqlite.SQLInputValue> = {};
    for (const [key, value] of Object.entries(first)) named[key] = toSqlInput(value);
    return [named as unknown as NodeSqlite.SQLInputValue, ...rest.map((p) => toSqlInput(p as SqlParam))];
  }
  return params.map((p) => toSqlInput(p as SqlParam));
}

export class SqliteStatement<Row extends object = SqlRow> {
  private readonly stmt: NodeSqlite.StatementSync;

  constructor(stmt: NodeSqlite.StatementSync) {
    this.stmt = stmt;
  }

  run(...params: (SqlParam | SqlNamedParams)[]): RunResult {
    const result = this.stmt.run(...bind(params));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  get(...params: (SqlParam | SqlNamedParams)[]): Row | undefined {
    return this.stmt.get(...bind(params)) as Row | undefined;
  }

  all(...params: (SqlParam | SqlNamedParams)[]): Row[] {
    return this.stmt.all(...bind(params)) as Row[];
  }
}

export class SqliteDatabase {
  /** The underlying `DatabaseSync` (needed to load extensions). */
  readonly raw: NodeSqlite.DatabaseSync;
  private txDepth = 0;
  private savepointSeq = 0;

  constructor(raw: NodeSqlite.DatabaseSync) {
    this.raw = raw;
  }

  prepare<Row extends object = SqlRow>(sql: string): SqliteStatement<Row> {
    return new SqliteStatement<Row>(this.raw.prepare(sql));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs `PRAGMA <statement>` and returns its rows (empty for assignments that return nothing). */
  pragma(statement: string): SqlRow[] {
    return this.prepare(`PRAGMA ${statement}`).all();
  }

  /**
   * Returns a function that runs `fn` inside BEGIN/COMMIT (ROLLBACK and rethrow on error).
   * Calls made while a transaction is already open use a SAVEPOINT, so nesting is safe.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const nested = this.txDepth > 0;
      const savepoint = `sp_${String(++this.savepointSeq)}`;
      this.raw.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.txDepth++;
      try {
        const result = fn(...args);
        this.txDepth--;
        this.raw.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (err) {
        this.txDepth--;
        try {
          this.raw.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        } catch {
          /* the original error is the useful one */
        }
        throw err;
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}

/** Opens (creating if needed) a database; `:memory:` is allowed. */
export function openSqliteDatabase(dbPath: string, options: OpenSqliteOptions = {}): SqliteDatabase {
  const { DatabaseSync } = getNodeSqlite();
  return new SqliteDatabase(
    new DatabaseSync(dbPath, { readOnly: options.readonly === true, allowExtension: options.allowExtension === true }),
  );
}

/**
 * Loads the sqlite-vec extension into `db` (which must have been opened with `allowExtension`).
 * `nativeModulesDir` locates `node_modules/sqlite-vec` for bundled builds; default: this package's resolution.
 */
export function loadSqliteVec(db: SqliteDatabase, nativeModulesDir: string | undefined): void {
  try {
    const require = nativeModulesDir === undefined ? defaultRequire : createRequire(path.join(nativeModulesDir, 'index.js'));
    const sqliteVec = require('sqlite-vec') as { load: (db: NodeSqlite.DatabaseSync) => void };
    sqliteVec.load(db.raw);
  } catch (err) {
    throw new Error(`Failed to load sqlite-vec extension: ${String(err)}`, { cause: err });
  }
}
