#!/usr/bin/env node
import { McpServer, StdioServerTransport, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';
import { McpLogger } from './core/logger.js';

async function main() {
  const allowedReposEnv = process.env['GIT_ALLOWED_REPOS'];

  if (!allowedReposEnv) {
    console.error('Error: GIT_ALLOWED_REPOS environment variable not set');
    console.error('Usage: GIT_ALLOWED_REPOS="/path/to/repo1;/path/to/repo2" git-mcp-server');
    process.exit(1);
  }

  const allowedRepos = allowedReposEnv.split(';').filter(p => p.trim());

  if (allowedRepos.length === 0) {
    console.error('Error: No repositories configured in GIT_ALLOWED_REPOS');
    process.exit(1);
  }

  const repoManager = new RepositoryManager(allowedRepos);

  const server = new McpServer(
    { name: 'git-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  const logger = new McpLogger(server, 'git-server');

  createGitServer(server, repoManager, logger);

  if (process.env['MCP_TRANSPORT']?.toLowerCase() === 'http') {
    const port = parseInt(process.env['MCP_HTTP_PORT'] ?? '3000', 10);
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

    serve(
      { fetch: app.fetch, port },
      () => { logger.info(`Git MCP Server running on http://127.0.0.1:${String(port)}/mcp. Allowed repositories: ${allowedRepos.join(', ')}`); }
    ) as unknown as Server;

    const shutdown = async (): Promise<void> => {
      for (const [sid, t] of transports) {
        try { await t.close(); } catch (err) { process.stderr.write(`[ERROR] closing transport ${sid}: ${String(err)}\n`); }
      }
      transports.clear();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  } else {
    // Default: stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`Git MCP Server ready. Allowed repositories: ${allowedRepos.join(', ')}`);

    const shutdown = async (): Promise<void> => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[FATAL] ${String(error)}\n`);
  process.exit(1);
});
