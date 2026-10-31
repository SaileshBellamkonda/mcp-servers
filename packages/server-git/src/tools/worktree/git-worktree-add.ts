import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../../core/types.ts';
import { assertSafeRefLike } from '../../core/git-args.ts';

const GitWorktreeAddSchema = z.object({
  repository: z.string().describe('Repository path'),
  path: z.string().describe('Path for new worktree'),
  branch: z.string().optional().describe('Branch name'),
  commitish: z.string().optional().describe('Commit-ish reference'),
});

export function registerGitWorktreeAdd(server: McpServer, services: Services): void {
  server.registerTool(
    'git_worktree_add',
    {
      description: 'Create a new worktree',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          path: { type: 'string', description: 'Path for new worktree' },
          branch: { type: 'string', description: 'Branch name' },
          commitish: { type: 'string', description: 'Commit-ish reference' },
        },
        required: ['repository', 'path'],
      }),
    },
    async (input: unknown) => {
      const { repository, path: worktreePath, branch, commitish } = GitWorktreeAddSchema.parse(input);

      services.repoManager.validateRepository(repository);
      // Pass the validated absolute path: a relative value such as "-f" can no longer be parsed as an option.
      const safePath = services.pathValidator.validatePath(repository, worktreePath);
      if (branch) assertSafeRefLike(branch, 'branch');
      if (commitish) assertSafeRefLike(commitish, 'commitish');

      const args = ['worktree', 'add'];
      if (branch) args.push('-b', branch);
      args.push('--end-of-options', safePath);
      if (commitish) args.push(commitish);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_worktree_add', repository, error: result.stderr });
        throw new Error(`Git worktree add failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, path: worktreePath, branch }, null, 2) }],
      };
    }
  );
}
