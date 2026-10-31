import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';

const GitWorktreeLockSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Worktree path to lock'),
  reason: z.string().optional().describe('Reason for locking'),
});

export function registerGitWorktreeLock(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_lock',
    {
      description: 'Lock a worktree to prevent removal',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          path: { type: 'string', description: 'Worktree path to lock' },
          reason: { type: 'string', description: 'Reason for locking' },
        },
        required: ['repository', 'path'],
      }),
    },
    async (input: unknown) => {
      const { repository, path: worktreePath, reason } = GitWorktreeLockSchema.parse(input);

      services.repoManager.validateRepository(repository);
      const safePath = services.pathValidator.validatePath(repository, worktreePath);

      const args = ['worktree', 'lock'];
      if (reason) args.push('--reason', reason);
      args.push(safePath);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_lock', repository, path: worktreePath, error: result.stderr });
        throw new Error(`Git worktree lock failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, locked: worktreePath, reason }, null, 2) }],
      };
    }
  );
}
