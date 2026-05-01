import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

interface GitServerInstance {
  server: McpServer;
  app: express.Express;
  httpServer: Server;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
}

/**
 * Activate Git MCP Server in embedded mode (VS Code extension)
 * @param workspaceFolders Array of workspace folder paths
 * @param port HTTP server port (default: 3000)
 * @returns Server instance for cleanup
 */
export async function activateGitServer(
  workspaceFolders: string[],
  port: number = 3000
): Promise<GitServerInstance> {
  if (workspaceFolders.length === 0) {
    throw new Error('No workspace folders provided for Git MCP Server');
  }
  
  // Create repository manager
  const repoManager = new RepositoryManager(workspaceFolders);
  
  // Create MCP server
  const server = new McpServer(
    {
      name: 'git-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Register tools
  createGitServer(server, repoManager);

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);

  // Create Express app with MCP middleware
  const app: express.Express = createMcpExpressApp({ host: '127.0.0.1' });
  
  // Map to store transports by session ID
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  // MCP POST endpoint
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    try {
      let transport: WebStandardStreamableHTTPServerTransport;
      
      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport
        transport = transports.get(sessionId)!;
      } else if (!sessionId) {
        // New initialization request
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
        });
        
        // Set up onclose handler
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
          }
        };
        
        // Connect server to transport
        await server.connect(transport);
      } else {
        res.status(400).send('Invalid session ID');
        return;
      }
      
      return await transport.handleRequest(req);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    }
  });
  
  // MCP GET endpoint (for SSE)
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });
  
  // MCP DELETE endpoint (session termination)
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });
  
  // Start HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`Git MCP Server running on port ${port}`);
    console.log(`Allowed repositories: ${workspaceFolders.join(', ')}`);
  });
  
  return {
    server,
    app,
    httpServer,
    transports,
  };
}

/**
 * Deactivate Git MCP Server and clean up resources
 */
export async function deactivateGitServer(instance: GitServerInstance): Promise<void> {
  // Close all transports
  for (const [sessionId, transport] of instance.transports) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  instance.transports.clear();
  
  // Close HTTP server
  return new Promise((resolve, reject) => {
    instance.httpServer.close((err) => {
      if (err) {
        reject(err);
      } else {
        console.log('Git MCP Server stopped');
        resolve();
      }
    });
  });
}

/**
 * Update allowed repositories dynamically (for workspace folder changes)
 */
export function updateAllowedRepositories(
  repoManager: RepositoryManager,
  workspaceFolders: string[]
): void {
  repoManager.updateAllowedRepositories(workspaceFolders);
  console.log(`Updated allowed repositories: ${workspaceFolders.join(', ')}`);
}
