import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeRemoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to remove'),
  force: z.boolean().default(false).describe('Force removal')
});

export function registerGitWorktreeRemove(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_remove',
    {
      description: 'Remove a worktree',
      inputSchema: GitWorktreeRemoveSchema
    },
    async (input) => {
      const { repository, path, force } = GitWorktreeRemoveSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(path);
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree remove failed: ${result.stderr}`);
      
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, removed: path }, null, 2) }] };
    }
  );
}
