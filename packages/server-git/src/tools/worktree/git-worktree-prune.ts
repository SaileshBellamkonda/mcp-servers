import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreePruneSchema = z.object({
  repository: z.string().describe('Repository path'),
  dry_run: z.boolean().default(false).describe('Show what would be pruned')
});

export function registerGitWorktreePrune(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_prune',
    {
      description: 'Prune stale worktree administrative files',
      inputSchema: GitWorktreePruneSchema
    },
    async (input) => {
      const { repository, dry_run } = GitWorktreePruneSchema.parse(input);
      services.repoManager.validateRepository(repository);
      
      const args = ['worktree', 'prune'];
      if (dry_run) args.push('--dry-run');
      
      const result = await services.gitExecutor.execute(repository, args);
      if (!result.success) throw new Error(`Git worktree prune failed: ${result.stderr}`);
      
      const pruned = result.stdout.split('\n').filter(line => line.trim());
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, pruned }, null, 2) }] };
    }
  );
}
