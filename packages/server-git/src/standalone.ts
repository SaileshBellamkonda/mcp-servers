#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { createGitServer } from './server/git-server.js';
import { RepositoryManager } from './core/repository-manager.js';

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
      },
    }
  );
  
  // Register tools
  createGitServer(server, repoManager);
  
  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('Git MCP Server running on stdio');
  console.error(`Allowed repositories: ${allowedRepos.join(', ')}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
