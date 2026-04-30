import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitBranchSchema = z.object({
  repository: z.string().describe('Repository path'),
  all: z.boolean().default(false).describe('Include remote branches')
});

export function registerGitBranch(server: McpServer, services: Services): void {
  server.registerTool(
    'git_branch',
    {
      description: 'List branches in a repository',
      inputSchema: GitBranchSchema
    },
    async (input) => {
      const { repository, all } = GitBranchSchema.parse(input);
      
      services.repoManager.validateRepository(repository);
      
      const args = all ? ['branch', '-a'] : ['branch'];
      const result = await services.gitExecutor.execute(repository, args);
      
      if (!result.success) {
        throw new Error(`Git branch failed: ${result.stderr}`);
      }
      
      const branches = services.outputParser.parseBranches(result.stdout);
      
      return {
        content: [{ type: 'text', text: JSON.stringify({ branches }, null, 2) }]
      };
    }
  );
}
