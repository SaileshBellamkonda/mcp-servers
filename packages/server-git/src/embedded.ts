import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { serve } from '@hono/node-server';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';
import { McpLogger } from './core/logger.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

interface GitServerInstance {
  server: McpServer;
  httpServer: Server;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
}

export function activateGitServer(
  workspaceFolders: string[],
  port = 3000
): GitServerInstance {
  if (workspaceFolders.length === 0) {
    throw new Error('No workspace folders provided for Git MCP Server');
  }

  const repoManager = new RepositoryManager(workspaceFolders);

  const server = new McpServer(
    { name: 'git-server', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  const logger = new McpLogger(server, 'git-server');
  createGitServer(server, repoManager, logger);

  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const app = createMcpHonoApp({ host: '127.0.0.1' });

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
    () => {
      logger.info(`Git MCP Server running on port ${String(port)}. Allowed repositories: ${workspaceFolders.join(', ')}`);
    }
  ) as unknown as Server;

  return { server, httpServer, transports };
}

export async function deactivateGitServer(instance: GitServerInstance): Promise<void> {
  for (const [sid, transport] of instance.transports) {
    try {
      await transport.close();
    } catch (err) {
      process.stderr.write(`[ERROR] closing transport ${sid}: ${String(err)}\n`);
    }
  }
  instance.transports.clear();
  return new Promise((resolve, reject) => {
    instance.httpServer.close((err) => { if (err) reject(err); else resolve(); });
  });
}

export function updateAllowedRepositories(
  repoManager: RepositoryManager,
  workspaceFolders: string[]
): void {
  repoManager.updateAllowedRepositories(workspaceFolders);
  process.stderr.write(`[INFO] Updated allowed repositories: ${workspaceFolders.join(', ')}\n`);
}
