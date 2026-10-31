import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';

const GitWorktreeUnlockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to unlock'),
});

export function registerGitWorktreeUnlock(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_unlock',
    {
      description: 'Unlock a worktree to allow removal',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          path: { type: 'string', description: 'Worktree path to unlock' },
        },
        required: ['repository', 'path'],
      }),
    },
    async (input: unknown) => {
      const { repository, path: worktreePath } = GitWorktreeUnlockSchema.parse(input);

      services.repoManager.validateRepository(repository);
      const safePath = services.pathValidator.validatePath(repository, worktreePath);

      const result = await services.gitExecutor.execute(repository, ['worktree', 'unlock', safePath]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_unlock', repository, path: worktreePath, error: result.stderr });
        throw new Error(`Git worktree unlock failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, unlocked: worktreePath }, null, 2) }],
      };
    }
  );
}
