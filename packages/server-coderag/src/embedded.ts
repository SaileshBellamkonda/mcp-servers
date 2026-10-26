import { McpServer } from '@modelcontextprotocol/server';
import { McpLogger } from '@mcp-servers/common';
import { requireToken, startMcpHttpServer, type McpHttpServer } from '@mcp-servers/http-host';
import { loadConfigFromVsCode, type VsCodeConfiguration } from './core/config.js';
import { resolveDimensions } from './core/dimensions.js';
import { createStderrLogger, type CodeRagLogger } from './core/logger.js';
import { Embedder } from './embedder/embedder.js';
import { VectorDB } from './vectordb/db.js';
import { probeSqliteSupport, type SqliteProbeDeps, type SqliteProbeResult } from './vectordb/sqlite-probe.js';
import { CodeParser } from './indexer/code-parser.js';
import { Indexer } from './indexer/indexer.js';
import { GlobMatcher } from './core/glob-utils.js';
import { PathGuard, computeAllowedRoots } from './core/path-guard.js';
import { SyncManager } from './indexer/sync-manager.js';
import { runStartupSync } from './indexer/sync.js';
import { createCodeRagServer } from './server/coderag-server.js';

export interface ActivateCodeRagServerOptions {
  /** The extension's `coderag` configuration section. */
  vsCodeConfig: VsCodeConfiguration;
  /** Every workspace folder; all of them are indexed and confine the file tools. Must not be empty. */
  workspaceFolders: string[];
  /** TCP port on 127.0.0.1 (default 3100; 0 picks a free port). */
  port?: number;
  /** Bearer token clients must send (>= 32 characters). Required: embedded servers always authenticate. */
  authToken: string;
  /** Directory whose `node_modules` holds tree-sitter, the grammars and sqlite-vec (bundled builds). */
  nativeModulesDir?: string;
  /** Embedding API key; overrides the one in the configuration (e.g. read from SecretStorage). */
  apiKey?: string;
  /** Receives diagnostics from the long-lived services (defaults to stderr). */
  logger?: CodeRagLogger;
}

export interface CodeRagServerInstance {
  /** The port actually bound. */
  port: number;
  /** The bound host (always the IPv4 loopback address). */
  host: string;
  /** Stops accepting connections, closes every session, the indexer and the database. */
  close(): Promise<void>;
}

export async function activateCodeRagServer(options: ActivateCodeRagServerOptions): Promise<CodeRagServerInstance> {
  const { workspaceFolders } = options;
  const token = requireToken(options.authToken);
  const [cwd] = workspaceFolders;
  if (cwd === undefined) {
    throw new Error('No workspace folders provided for CodeRAG MCP Server');
  }

  const loaded = loadConfigFromVsCode(options.vsCodeConfig, workspaceFolders);
  const config = options.apiKey !== undefined && options.apiKey !== ''
    ? { ...loaded, embedding: { ...loaded.embedding, apiKey: options.apiKey } }
    : loaded;
  const { nativeModulesDir } = options;
  // Shared services outlive every session, so they never log through a session's server.
  const logger = options.logger ?? createStderrLogger('coderag');

  const embedder = new Embedder(config.embedding);
  const dimensions = resolveDimensions(config, logger);
  const db = VectorDB.open(config.dbPath, dimensions, { nativeModulesDir });
  const syncManager = new SyncManager();

  const pathGuard = new PathGuard(computeAllowedRoots({
    cwdOrFolders: workspaceFolders,
    globs: config.globs,
    extraRoots: config.allowedRoots,
  }));

  const docsMatcher = new GlobMatcher(config.globs.docsInclude, config.globs.docsExclude, cwd, config.useGitignore, { pathGuard, warn: (msg) => { logger.warning(msg); } });
  const codeMatcher = new GlobMatcher(config.globs.codeInclude, config.globs.codeExclude, cwd, config.useGitignore, { pathGuard, warn: (msg) => { logger.warning(msg); } });

  const indexer = new Indexer(db, embedder, config.chunkSize, { docsMatcher, codeMatcher, logger, pathGuard, nativeModulesDir });

  const includeDirs = [...new Set(config.globs.docsInclude.map((p) => {
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const base = abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '');
    return base || cwd;
  }))];

  // Startup sync runs once, when the first session connects (not for every session).
  let startupSyncStarted = false;

  let httpServer: McpHttpServer;
  try {
    httpServer = await startMcpHttpServer({
      createServer: () => {
        const server = new McpServer(
          { name: 'coderag-server', version: '1.0.0' },
          { capabilities: { tools: {}, logging: {} } }
        );
        createCodeRagServer(
          server, db, embedder, indexer, config.topK, includeDirs, syncManager,
          options.logger ?? new McpLogger(server, 'coderag'),
          config.dbPath, config.embedding.model, pathGuard,
        );
        return server;
      },
      port: options.port ?? 3100,
      host: '127.0.0.1',
      token,
      logger,
      onSessionCreated: () => {
        if (startupSyncStarted) return;
        startupSyncStarted = true;
        setImmediate(() => {
          void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
            logger.error(`Startup sync failed: ${String(err)}`);
          });
        });
      },
    });
  } catch (err) {
    indexer.close();
    db.close();
    throw err;
  }

  let closing: Promise<void> | undefined;
  return {
    port: httpServer.port,
    host: httpServer.host,
    close: () => {
      closing ??= (async () => {
        await httpServer.close();
        indexer.close();
        db.close();
      })();
      return closing;
    },
  };
}

export type { SqliteProbeResult as CodeRagProbeResult };

/** Replaceable steps of {@link probeCodeRagSupport}; the defaults are the real probes. */
export interface CodeRagProbeDeps {
  probeSqlite?: (deps?: SqliteProbeDeps) => SqliteProbeResult;
  /** Constructs the tree-sitter parser (which loads every grammar available) from `nativeModulesDir`; throws on failure. */
  createParser?: (nativeModulesDir: string | undefined) => void;
}

/**
 * Whether this runtime can run CodeRAG: Node.js, `node:sqlite` (with extensions, FTS5), sqlite-vec, then
 * tree-sitter with its grammars. Never throws; a failure is `{ ok: false, reason }` (`needs: 'fts5'` when only
 * keyword search is missing). The VS Code extension calls this before offering the server.
 */
export function probeCodeRagSupport(
  options: { nativeModulesDir?: string | undefined } = {},
  deps: CodeRagProbeDeps = {},
): SqliteProbeResult {
  const { nativeModulesDir } = options;
  const sqlite = (deps.probeSqlite ?? probeSqliteSupport)({ nativeModulesDir });
  if (!sqlite.ok) return sqlite;
  try {
    (deps.createParser ?? ((dir: string | undefined): void => { new CodeParser({ nativeModulesDir: dir }); }))(nativeModulesDir);
  } catch (err) {
    return { ok: false, reason: `tree-sitter is unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}

export async function deactivateCodeRagServer(instance: CodeRagServerInstance): Promise<void> {
  await instance.close();
}
