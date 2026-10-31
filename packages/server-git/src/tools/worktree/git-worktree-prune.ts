import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';

const GitWorktreePruneSchema = z.object({
  repository: z.string().describe('Repository path'),
  dry_run: z.boolean().default(false).describe('Show what would be pruned'),
});

export function registerGitWorktreePrune(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_prune',
    {
      description: 'Prune stale worktree administrative files',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          dry_run: { type: 'boolean', description: 'Show what would be pruned' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, dry_run } = GitWorktreePruneSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['worktree', 'prune'];
      if (dry_run) args.push('--dry-run');

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_prune', repository, error: result.stderr });
        throw new Error(`Git worktree prune failed: ${result.stderr}`);
      }

      const pruned = result.stdout.split('\n').filter(line => line.trim());

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, pruned }, null, 2) }],
      };
    }
  );
}
