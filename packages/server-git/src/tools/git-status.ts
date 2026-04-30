import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitStatusSchema = z.object({
  repository: z.string().describe('Repository path')
});

export function registerGitStatus(server: McpServer, services: Services): void {
  server.registerTool(
    'git_status',
    {
      description: 'Get the current status of a Git repository',
      inputSchema: GitStatusSchema
    },
    async (input) => {
      const { repository } = GitStatusSchema.parse(input);
      
      // Validate repository
      services.repoManager.validateRepository(repository);
      
      // Execute git status
      const result = await services.gitExecutor.execute(
        repository,
        ['status', '--porcelain', '--branch']
      );
      
      if (!result.success) {
        throw new Error(`Git status failed: ${result.stderr}`);
      }
      
      // Parse output
      const lines = result.stdout.split('\n');
      const branchLine = lines[0];
      const fileLines = lines.slice(1).join('\n');
      
      // Extract branch info
      const branchMatch = branchLine.match(/## ([^\s.]+)/);
      const branch = branchMatch ? branchMatch[1] : 'unknown';
      
      // Parse file statuses
      const files = services.outputParser.parseStatus(fileLines);
      
      const status = {
        branch,
        ahead: 0,
        behind: 0,
        files
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }
  );
}
