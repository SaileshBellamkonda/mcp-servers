import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import path from 'node:path';
import type { Services } from '../core/types.js';

export function registerGitWorkspaces(server: McpServer, services: Services): void {
  server.registerTool(
    'git_workspaces',
    {
      description: 'List all allowed Git repositories',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {},
      }),
    },
    () => {
      const repos = services.repoManager.getAllowedRepositories();

      const repositories = repos.map(repoPath => ({
        path: repoPath,
        name: path.basename(repoPath),
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ repositories }, null, 2) }],
      };
    }
  );
}
