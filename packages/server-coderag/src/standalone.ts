#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { McpLogger, parsePort } from '@mcp-servers/common';
import { resolveHttpSecurity, startMcpHttpServer, type McpHttpServer } from '@mcp-servers/http-host';
import { loadConfigFromEnv } from './core/config.ts';
import { resolveDimensions } from './core/dimensions.ts';
import { createStderrLogger, type CodeRagLogger } from './core/logger.ts';
import { Embedder } from './embedder/embedder.ts';
import { VectorDB } from './vectordb/db.ts';
import { Indexer } from './indexer/indexer.ts';
import { GlobMatcher } from './core/glob-utils.ts';
import { PathGuard, computeAllowedRoots } from './core/path-guard.ts';
import { SyncManager } from './indexer/sync-manager.ts';
import { runStartupSync } from './indexer/sync.ts';
import { createCodeRagServer } from './server/coderag-server.ts';
import { CodeRagWatcher, computeWatchDirs } from './indexer/watcher.ts';
import { FileRefresher } from './indexer/refresher.ts';
import { IndexFreshness } from './indexer/freshness.ts';
import { loadRuntimeOptionsFromEnv } from './core/toolset.ts';

function newServer(): McpServer {
  return new McpServer(
    { name: 'coderag-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
}

async function main(): Promise<void> {
  const httpMode = process.env['MCP_TRANSPORT']?.toLowerCase() === 'http';
  // Validate the HTTP binding before any resource is opened.
  const security = httpMode ? resolveHttpSecurity(process.env) : undefined;
  const port = parsePort(process.env['MCP_HTTP_PORT'], 3100);

  const config = loadConfigFromEnv(process.env);
  const runtime = loadRuntimeOptionsFromEnv(process.env);
  const embedder = new Embedder(config.embedding);
  const cwd = process.cwd();

  // stdio has exactly one server, so its logger can talk to the client. In HTTP mode the indexer,
  // watcher and startup sync outlive every session and must not be bound to one session's server.
  const stdioServer = httpMode ? undefined : newServer();
  const logger: CodeRagLogger = stdioServer ? new McpLogger(stdioServer, 'coderag') : createStderrLogger('coderag');

  const dimensions = resolveDimensions(config, logger);
  const db = VectorDB.open(config.dbPath, dimensions);
  const syncManager = new SyncManager();

  const pathGuard = new PathGuard(computeAllowedRoots({ cwdOrFolders: [cwd], globs: config.globs, extraRoots: config.allowedRoots }));

  const docsMatcher = new GlobMatcher(config.globs.docsInclude, config.globs.docsExclude, cwd, config.useGitignore, { pathGuard, warn: (msg) => { logger.warning(msg); } });
  const codeMatcher = new GlobMatcher(config.globs.codeInclude, config.globs.codeExclude, cwd, config.useGitignore, { pathGuard, warn: (msg) => { logger.warning(msg); } });

  const indexer = new Indexer(db, embedder, config.chunkSize, { docsMatcher, codeMatcher, logger, pathGuard });

  // Use docsInclude roots as the default sync dirs for sync_documents tool
  const includeDirs = [...new Set(config.globs.docsInclude.map((p) => {
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const base = abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '');
    return base || cwd;
  }))];

  const freshness = new IndexFreshness(db, new FileRefresher(db, indexer, docsMatcher, codeMatcher, logger), syncManager, logger);

  const registerTools = (server: McpServer, toolLogger: CodeRagLogger): void => {
    createCodeRagServer(server, db, embedder, indexer, config.topK, includeDirs, syncManager, toolLogger, config.dbPath, config.embedding.model, pathGuard, { toolset: runtime.toolset, freshness });
  };

  const scheduleStartupSync = (): void => {
    setImmediate(() => {
      void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
        logger.error(`Startup sync failed: ${String(err)}`);
      });
    });
  };

  // Real-time file watcher: on unless CODERAG_WATCH=0 (or false/no/off)
  let watcher: CodeRagWatcher | undefined;
  if (runtime.watch) {
    watcher = new CodeRagWatcher(db, indexer, syncManager, docsMatcher, codeMatcher, logger);
    watcher.start(computeWatchDirs(config.globs, cwd));
  }

  if (security) {
    let httpServer: McpHttpServer;
    try {
      httpServer = await startMcpHttpServer({
        createServer: () => {
          const server = newServer();
          registerTools(server, new McpLogger(server, 'coderag'));
          return server;
        },
        port,
        host: security.host,
        token: security.token,
        logger,
      });
    } catch (err) {
      watcher?.close();
      freshness.close();
      indexer.close();
      db.close();
      throw err;
    }
    logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

    scheduleStartupSync();

    const shutdown = async (): Promise<void> => {
      watcher?.close();
      freshness.close();
      try {
        await httpServer.close();
      } catch (err) {
        logger.error(`closing HTTP server: ${String(err)}`);
      }
      indexer.close();
      db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  } else if (stdioServer) {
    registerTools(stdioServer, logger);
    // The startup sync does blocking work (the file walk), so it waits for the client's handshake to finish:
    // started earlier, it can stall the reply to `initialize` past the client's connect timeout.
    stdioServer.server.oninitialized = scheduleStartupSync;
    const transport = new StdioServerTransport();
    await stdioServer.connect(transport);
    logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

    const shutdown = async (): Promise<void> => {
      watcher?.close();
      freshness.close();
      await stdioServer.close();
      indexer.close();
      db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[FATAL] ${String(err)}\n`);
  process.exit(1);
});
