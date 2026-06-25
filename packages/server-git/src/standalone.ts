#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';
import { McpLogger } from './core/logger.js';

async function main() {
  // Parse allowed repositories from environment
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
  
  // Create repository manager
  const repoManager = new RepositoryManager(allowedRepos);
  
  // Create MCP server
  const server = new McpServer(
    {
      name: 'git-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );
  const logger = new McpLogger(server, 'git-server');

  // Register tools
  createGitServer(server, repoManager, logger);

  // Connect stdio transport
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

main().catch((error: unknown) => {
  process.stderr.write(`[FATAL] ${String(error)}\n`);
  process.exit(1);
});
