#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { McpLogger, parseBool, parsePort } from '@mcp-servers/common';
import { resolveHttpSecurity, startMcpHttpServer, type McpHttpServer } from '@mcp-servers/http-host';
import { loadConfigFromEnv } from './core/config.js';
import { resolveDimensions } from './core/dimensions.js';
import { createStderrLogger, type CodeRagLogger } from './core/logger.js';
import { Embedder } from './embedder/embedder.js';
import { VectorDB } from './vectordb/db.js';
import { Indexer } from './indexer/indexer.js';
import { GlobMatcher } from './core/glob-utils.js';
import { PathGuard, computeAllowedRoots } from './core/path-guard.js';
import { SyncManager } from './indexer/sync-manager.js';
import { runStartupSync } from './indexer/sync.js';
import { createCodeRagServer } from './server/coderag-server.js';
import { CodeRagWatcher } from './indexer/watcher.js';

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
  const embedder = new Embedder(config.embedding);
  const cwd = process.cwd();

  // stdio has exactly one server, so its logger can talk to the client. In HTTP mode the indexer,
  // watcher and startup sync outlive every session and must not be bound to one session's server.
  const stdioServer = httpMode ? undefined : newServer();
  const logger: CodeRagLogger = stdioServer ? new McpLogger(stdioServer, 'coderag') : createStderrLogger('coderag');

  const dimensions = resolveDimensions(config, logger);
  const db = VectorDB.open(config.dbPath, dimensions);
  const syncManager = new SyncManager();

  const docsMatcher = new GlobMatcher(config.globs.docsInclude, config.globs.docsExclude, cwd, config.useGitignore);
  const codeMatcher = new GlobMatcher(config.globs.codeInclude, config.globs.codeExclude, cwd, config.useGitignore);

  const pathGuard = new PathGuard(computeAllowedRoots({ cwdOrFolders: [cwd], globs: config.globs, extraRoots: config.allowedRoots }));

  const indexer = new Indexer(db, embedder, config.chunkSize, { docsMatcher, codeMatcher, logger, pathGuard });

  // Use docsInclude roots as the default sync dirs for sync_documents tool
  const includeDirs = [...new Set(config.globs.docsInclude.map((p) => {
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const base = abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '');
    return base || cwd;
  }))];

  const registerTools = (server: McpServer, toolLogger: CodeRagLogger): void => {
    createCodeRagServer(server, db, embedder, indexer, config.topK, includeDirs, syncManager, toolLogger, config.dbPath, config.embedding.model, pathGuard);
  };

  const scheduleStartupSync = (): void => {
    setImmediate(() => {
      void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
        logger.error(`Startup sync failed: ${String(err)}`);
      });
    });
  };

  // Optional real-time file watcher (CODERAG_WATCH=true)
  let watcher: CodeRagWatcher | undefined;
  if (parseBool(process.env['CODERAG_WATCH'], false)) {
    const codeWatchDirs = config.globs.codeInclude.map((p) => {
      const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
      return abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '') || cwd;
    });
    const watchDirs = [...new Set([...includeDirs, ...codeWatchDirs])];
    watcher = new CodeRagWatcher(db, indexer, syncManager, docsMatcher, codeMatcher, logger);
    watcher.start(watchDirs);
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
      indexer.close();
      db.close();
      throw err;
    }
    logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

    scheduleStartupSync();

    const shutdown = async (): Promise<void> => {
      watcher?.close();
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
    const transport = new StdioServerTransport();
    await stdioServer.connect(transport);
    logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

    scheduleStartupSync();

    const shutdown = async (): Promise<void> => {
      watcher?.close();
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
