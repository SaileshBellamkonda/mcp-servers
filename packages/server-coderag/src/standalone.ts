#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
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

  createCodeRagServer(server, db, embedder, indexer, config.topK, [...new Set(includeDirs)], syncManager, logger);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

  // Startup sync runs in background — does not block MCP responses
  setImmediate(() => {
    void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
      logger.error(`Startup sync failed: ${String(err)}`);
    });
  });

  const shutdown = async (): Promise<void> => {
    await server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err: unknown) => {
  process.stderr.write(`[FATAL] ${String(err)}\n`);
  process.exit(1);
});
