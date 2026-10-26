import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';
import { assertSafeRefLike } from '../core/git-args.js';

const GitDiffSchema = z.object({
  repository: z.string().describe('Repository path'),
  target: z.string().optional().describe('Diff target (file, commit, or branch)'),
  staged: z.boolean().default(false).describe('Show staged changes only'),
});

export function registerGitDiff(server: McpServer, services: Services): void {
  server.registerTool(
    'git_diff',
    {
      description: 'Show changes in the repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          target: { type: 'string', description: 'Diff target (file, commit, or branch)' },
          staged: { type: 'boolean', description: 'Show staged changes only' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, target, staged } = GitDiffSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['diff'];
      if (staged) args.push('--staged');
      if (target) args.push('--end-of-options', assertSafeRefLike(target, 'target'));

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_diff', repository, error: result.stderr });
        throw new Error(`Git diff failed: ${result.stderr}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ diff: result.stdout }, null, 2) }],
      };
    }
  );
}
