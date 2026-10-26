import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.js';

const GitWorktreeRemoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to remove'),
  force: z.boolean().default(false).describe('Force removal'),
});

export function registerGitWorktreeRemove(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_remove',
    {
      description: 'Remove a worktree',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          path: { type: 'string', description: 'Worktree path to remove' },
          force: { type: 'boolean', description: 'Force removal' },
        },
        required: ['repository', 'path'],
      }),
    },
    async (input: unknown) => {
      const { repository, path: worktreePath, force } = GitWorktreeRemoveSchema.parse(input);

      services.repoManager.validateRepository(repository);
      const safePath = services.pathValidator.validatePath(repository, worktreePath);

      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(safePath);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_remove', repository, error: result.stderr });
        throw new Error(`Git worktree remove failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, removed: worktreePath }, null, 2) }],
      };
    }
  );
}
