import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeListSchema = z.object({
  repository: z.string().describe('Repository path')
});

export function registerGitWorktreeList(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_list',
    {
      description: 'List all worktrees in a repository',
      inputSchema: GitWorktreeListSchema
    },
    async (input) => {
      const { repository } = GitWorktreeListSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'list', '--porcelain']);
      if (!result.success) throw new Error(`Git worktree list failed: ${result.stderr}`);
      
      const worktrees = services.outputParser.parseWorktrees(result.stdout);
      return { content: [{ type: 'text', text: JSON.stringify({ worktrees }, null, 2) }] };
    }
  );
}
