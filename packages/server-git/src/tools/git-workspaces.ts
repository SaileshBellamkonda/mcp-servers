import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import path from 'path';
import type { Services } from '../core/types.js';

const GitWorkspacesSchema = z.object({});

export function registerGitWorkspaces(server: McpServer, services: Services): void {
  server.registerTool(
    'git_workspaces',
    {
      description: 'List all allowed Git repositories',
      inputSchema: GitWorkspacesSchema
    },
    async () => {
      const repos = services.repoManager.getAllowedRepositories();
      
      const repositories = repos.map(repoPath => ({
        path: repoPath,
        name: path.basename(repoPath)
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ repositories }, null, 2)
          }
        ]
      };
    }
  );
}
