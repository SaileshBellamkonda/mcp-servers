#!/usr/bin/env node
import { McpServer, StdioServerTransport, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfigFromEnv } from './core/config.js';
import type { CodeRagConfig } from './core/types.js';
import { Embedder } from './embedder/embedder.js';
import { VectorDB } from './vectordb/db.js';
import { Indexer } from './indexer/indexer.js';
import { GlobMatcher } from './core/glob-utils.js';
import { McpLogger } from './core/logger.js';
import { SyncManager } from './indexer/sync-manager.js';
import { runStartupSync } from './indexer/sync.js';
import { createCodeRagServer } from './server/coderag-server.js';
import { CodeRagWatcher } from './indexer/watcher.js';

function resolveDimensions(config: CodeRagConfig): number {
  const stored = VectorDB.readStoredDimensions(config.dbPath);
  if (stored !== null && stored !== config.embeddingDim) {
    process.stderr.write(`[WARN] Embedding dimension changed (${String(stored)} → ${String(config.embeddingDim)}). Vectors will be reset and a full re-index will run on startup.\n`);
  }
  if (stored !== null) {
    process.stderr.write(`[INFO] Using stored embedding dimensions: ${String(stored)}\n`);
    return stored;
  }
  process.stderr.write(`[INFO] Using configured embedding dimensions: ${String(config.embeddingDim)}\n`);
  return config.embeddingDim;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const embedder = new Embedder(config.embedding);
  const cwd = process.cwd();

  const dimensions = resolveDimensions(config);
  const db = VectorDB.open(config.dbPath, dimensions);

  const server = new McpServer(
    { name: 'coderag-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  const logger = new McpLogger(server, 'coderag');
  const syncManager = new SyncManager();

  const docsMatcher = new GlobMatcher(config.globs.docsInclude, config.globs.docsExclude, cwd, config.useGitignore);
  const codeMatcher = new GlobMatcher(config.globs.codeInclude, config.globs.codeExclude, cwd, config.useGitignore);

  const indexer = new Indexer(db, embedder, config.chunkSize, { docsMatcher, codeMatcher, logger });

  // Use docsInclude roots as the default sync dirs for sync_documents tool
  const includeDirs = config.globs.docsInclude.map((p) => {
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const base = abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '');
    return base || cwd;
  });

  createCodeRagServer(server, db, embedder, indexer, config.topK, [...new Set(includeDirs)], syncManager, logger, config.dbPath, config.embedding.model);

  const scheduleStartupSync = (): void => {
    setImmediate(() => {
      void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
        logger.error(`Startup sync failed: ${String(err)}`);
      });
    });
  };

  // Optional real-time file watcher (CODERAG_WATCH=true)
  let watcher: CodeRagWatcher | undefined;
  if (process.env['CODERAG_WATCH']?.toLowerCase() === 'true') {
    const codeWatchDirs = config.globs.codeInclude.map((p) => {
      const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
      return abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '') || cwd;
    });
    const watchDirs = [...new Set([...includeDirs, ...codeWatchDirs])];
    watcher = new CodeRagWatcher(db, indexer, syncManager, docsMatcher, codeMatcher, logger);
    watcher.start(watchDirs);
  }

  if (process.env['MCP_TRANSPORT']?.toLowerCase() === 'http') {
    const port = parseInt(process.env['MCP_HTTP_PORT'] ?? '3100', 10);
    const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
    const app = createMcpHonoApp({ host: '127.0.0.1' });

    app.post('/mcp', async (c) => {
      const sessionId = c.req.header('mcp-session-id');
      try {
        let t: WebStandardStreamableHTTPServerTransport;
        if (sessionId) {
          const existing = transports.get(sessionId);
          if (!existing) return c.text('Invalid session ID', 400);
          t = existing;
        } else {
          t = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => { transports.set(sid, t); },
          });
          t.onclose = () => {
            const sid = t.sessionId;
            if (sid) transports.delete(sid);
          };
          await server.connect(t);
        }
        return await t.handleRequest(c.req.raw);
      } catch (err) {
        logger.error(`MCP request error: ${String(err)}`);
        return c.text('Internal server error', 500);
      }
    });

    app.get('/mcp', (c) => {
      const sessionId = c.req.header('mcp-session-id');
      const t = sessionId ? transports.get(sessionId) : undefined;
      if (!t) return c.text('Invalid or missing session ID', 400);
      return t.handleRequest(c.req.raw);
    });

    app.delete('/mcp', (c) => {
      const sessionId = c.req.header('mcp-session-id');
      const t = sessionId ? transports.get(sessionId) : undefined;
      if (!t) return c.text('Invalid or missing session ID', 400);
      return t.handleRequest(c.req.raw);
    });

    const httpServer = serve(
      { fetch: app.fetch, port },
      () => { logger.info(`CodeRAG MCP Server running on http://127.0.0.1:${String(port)}/mcp (model: ${config.embedding.model}, db: ${config.dbPath})`); }
    ) as unknown as Server;

    scheduleStartupSync();

    const shutdown = async (): Promise<void> => {
      watcher?.close();
      for (const [sid, t] of transports) {
        try { await t.close(); } catch (err) { process.stderr.write(`[ERROR] closing transport ${sid}: ${String(err)}\n`); }
      }
      transports.clear();
      indexer.close();
      db.close();
      await new Promise<void>((resolve) => { httpServer.close(() => { resolve(); }); });
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  } else {
    // Default: stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

    scheduleStartupSync();

    const shutdown = async (): Promise<void> => {
      watcher?.close();
      await server.close();
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
