import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeMoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  source: z.string().describe('Current worktree path'),
  destination: z.string().describe('New worktree path')
});

export function registerGitWorktreeMove(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_move',
    {
      description: 'Move a worktree to a new location',
      inputSchema: GitWorktreeMoveSchema
    },
    async (input) => {
      const { repository, source, destination } = GitWorktreeMoveSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'move', source, destination]);
      if (!result.success) throw new Error(`Git worktree move failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, from: source, to: destination }, null, 2) }] };
    }
  );
}
