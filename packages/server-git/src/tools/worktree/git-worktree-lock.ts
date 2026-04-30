import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeLockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to lock'),
  reason: z.string().optional().describe('Reason for locking')
});

export function registerGitWorktreeLock(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_lock',
    {
      description: 'Lock a worktree to prevent removal',
      inputSchema: GitWorktreeLockSchema
    },
    async (input) => {
      const { repository, path, reason } = GitWorktreeLockSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'lock'];
      if (reason) args.push('--reason', reason);
      args.push(path);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree lock failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, locked: path, reason }, null, 2) }] };
    }
  );
}
