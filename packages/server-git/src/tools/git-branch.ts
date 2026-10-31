import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';

const GitBranchSchema = z.object({
  repository: z.string().describe('Repository path'),
  all: z.boolean().default(false).describe('Include remote branches'),
});

export function registerGitBranch(server: McpServer, services: Services): void {
  server.registerTool(
    'git_branch',
    {
      description: 'List branches in a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          all: { type: 'boolean', description: 'Include remote branches' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, all } = GitBranchSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = all ? ['branch', '-a'] : ['branch'];
      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_branch', repository, error: result.stderr });
        throw new Error(`Git branch failed: ${result.stderr}`);
      }

      const branches = services.outputParser.parseBranches(result.stdout);

      return {
        content: [{ type: 'text', text: JSON.stringify({ branches }, null, 2) }],
      };
    }
  );
}
