import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';

const GitWorktreeListSchema = z.object({
  repository: z.string().describe('Repository path'),
});

export function registerGitWorktreeList(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_list',
    {
      description: 'List all worktrees in a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository } = GitWorktreeListSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const result = await services.gitExecutor.execute(repository, ['worktree', 'list', '--porcelain']);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_list', repository, error: result.stderr });
        throw new Error(`Git worktree list failed: ${result.stderr}`);
      }

      const worktrees = services.outputParser.parseWorktrees(result.stdout);

      return {
        content: [{ type: 'text', text: JSON.stringify({ worktrees }, null, 2) }],
      };
    }
  );
}
