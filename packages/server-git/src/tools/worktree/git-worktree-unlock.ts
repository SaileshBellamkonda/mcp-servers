import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeUnlockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to unlock')
});

export function registerGitWorktreeUnlock(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_unlock',
    {
      description: 'Unlock a worktree to allow removal',
      inputSchema: GitWorktreeUnlockSchema
    },
    async (input) => {
      const { repository, path } = GitWorktreeUnlockSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const result = await services.gitExecutor.execute(repository, ['worktree', 'unlock', path]);
      if (!result.success) throw new Error(`Git worktree unlock failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, unlocked: path }, null, 2) }] };
    }
  );
}
