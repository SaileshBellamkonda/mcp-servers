#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { loadConfigFromEnv } from './core/config.js';
import { Embedder } from './embedder/embedder.js';
import { VectorDB } from './vectordb/db.js';
import { Indexer } from './indexer/indexer.js';
import { McpLogger } from './core/logger.js';
import { createCodeRagServer } from './server/coderag-server.js';

async function resolveDimensions(embedder: Embedder, config: ReturnType<typeof loadConfigFromEnv>): Promise<number> {
  if (config.embeddingDim !== undefined) {
    process.stderr.write(`[INFO] Using configured embedding dimensions: ${String(config.embeddingDim)}\n`);
    return config.embeddingDim;
  }
  const stored = VectorDB.readStoredDimensions(config.dbPath);
  if (stored !== null) {
    process.stderr.write(`[INFO] Using stored embedding dimensions: ${String(stored)}\n`);
    return stored;
  }
  process.stderr.write('[INFO] New database — detecting embedding dimensions...\n');
  const dim = await embedder.detectDimensions();
  process.stderr.write(`[INFO] Detected embedding dimensions: ${String(dim)}\n`);
  return dim;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const embedder = new Embedder(config.embedding);

  const dimensions = await resolveDimensions(embedder, config);
  const db = VectorDB.open(config.dbPath, dimensions);

  const server = new McpServer(
    { name: 'coderag-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  const logger = new McpLogger(server, 'coderag');

  const indexer = new Indexer(db, embedder, config.chunkSize, {
    globalExclude: config.exclude,
    useGitignore: config.useGitignore,
    logger,
  });

  createCodeRagServer(server, db, embedder, indexer, config.topK, config.documentsDir, logger);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`CodeRAG MCP Server ready (model: ${config.embedding.model}, db: ${config.dbPath})`);

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
