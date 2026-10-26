import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfigFromVsCode, type VsCodeConfiguration } from './core/config.js';
import { Embedder } from './embedder/embedder.js';
import { VectorDB } from './vectordb/db.js';
import { Indexer } from './indexer/indexer.js';
import { GlobMatcher } from './core/glob-utils.js';
import { McpLogger } from './core/logger.js';
import { SyncManager } from './indexer/sync-manager.js';
import { runStartupSync } from './indexer/sync.js';
import { createCodeRagServer } from './server/coderag-server.js';

export interface CodeRagServerInstance {
  server: McpServer;
  db: VectorDB;
  indexer: Indexer;
  httpServer: Server;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  syncManager: SyncManager;
}

function resolveDimensions(config: ReturnType<typeof loadConfigFromVsCode>): number {
  const stored = VectorDB.readStoredDimensions(config.dbPath);
  if (stored !== null) {
    process.stderr.write(`[INFO] Using stored embedding dimensions: ${String(stored)}\n`);
    return stored;
  }
  process.stderr.write(`[INFO] Using configured embedding dimensions: ${String(config.embeddingDim)}\n`);
  return config.embeddingDim;
}

export function activateCodeRagServer(
  vsCodeConfig: VsCodeConfiguration,
  workspaceFolders: string[],
  port = 3100
): Promise<CodeRagServerInstance> {
  const config = loadConfigFromVsCode(vsCodeConfig, workspaceFolders);
  const cwd = workspaceFolders[0] ?? process.cwd();

  const embedder = new Embedder(config.embedding);
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

  const includeDirs = config.globs.docsInclude.map((p) => {
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const base = abs.replace(/[*?{[!].*$/, '').replace(/\/+$/, '');
    return base || cwd;
  });

  createCodeRagServer(server, db, embedder, indexer, config.topK, [...new Set(includeDirs)], syncManager, logger, config.dbPath, config.embedding.model);

  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const app = createMcpHonoApp({ host: '127.0.0.1' });
  let startupSyncStarted = false;

  app.post('/mcp', async (c) => {
    const sessionId = c.req.header('mcp-session-id');
    try {
      let transport: WebStandardStreamableHTTPServerTransport;
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) return c.text('Invalid session ID', 400);
        transport = existing;
      } else {
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports.set(sid, transport); },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };
        await server.connect(transport);

        // Startup sync once, on the first session connect (not on every session)
        if (!startupSyncStarted) {
          startupSyncStarted = true;
          setImmediate(() => {
            void runStartupSync(db, indexer, syncManager, config, cwd, logger).catch((err: unknown) => {
              logger.error(`Startup sync failed: ${String(err)}`);
            });
          });
        }
      }
      return await transport.handleRequest(c.req.raw);
    } catch (err) {
      logger.error(`MCP request error: ${String(err)}`);
      return c.text('Internal server error', 500);
    }
  });

  app.get('/mcp', (c) => {
    const sessionId = c.req.header('mcp-session-id');
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return c.text('Invalid or missing session ID', 400);
    return transport.handleRequest(c.req.raw);
  });

  app.delete('/mcp', (c) => {
    const sessionId = c.req.header('mcp-session-id');
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return c.text('Invalid or missing session ID', 400);
    return transport.handleRequest(c.req.raw);
  });

  const httpServer = serve(
    { fetch: app.fetch, port, hostname: '127.0.0.1' },
    () => { logger.info(`CodeRAG MCP Server running on port ${String(port)}`); }
  ) as unknown as Server;

  return Promise.resolve({ server, db, indexer, httpServer, transports, syncManager });
}

export async function deactivateCodeRagServer(instance: CodeRagServerInstance): Promise<void> {
  for (const [sid, transport] of instance.transports) {
    try { await transport.close(); } catch (err) { process.stderr.write(`[ERROR] closing transport ${sid}: ${String(err)}\n`); }
  }
  instance.transports.clear();
  instance.indexer.close();
  instance.db.close();
  return new Promise((resolve, reject) => {
    instance.httpServer.close((err) => { if (err) reject(err); else resolve(); });
  });
}
