import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';

const GitWorktreeMoveSchema = z.object({
  repository: z.string().describe('Repository path'),
  source: z.string().describe('Current worktree path'),
  destination: z.string().describe('New worktree path'),
});

export function registerGitWorktreeMove(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_move',
    {
      description: 'Move a worktree to a new location',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          source: { type: 'string', description: 'Current worktree path' },
          destination: { type: 'string', description: 'New worktree path' },
        },
        required: ['repository', 'source', 'destination'],
      }),
    },
    async (input: unknown) => {
      const { repository, source, destination } = GitWorktreeMoveSchema.parse(input);

      services.repoManager.validateRepository(repository);
      const safeSource = services.pathValidator.validatePath(repository, source);
      const safeDestination = services.pathValidator.validatePath(repository, destination);

      const result = await services.gitExecutor.execute(repository, ['worktree', 'move', safeSource, safeDestination]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_move', repository, source, error: result.stderr });
        throw new Error(`Git worktree move failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, from: source, to: destination }, null, 2) }],
      };
    }
  );
}
