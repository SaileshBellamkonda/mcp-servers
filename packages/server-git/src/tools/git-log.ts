import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitLogSchema = z.object({
  repository: z.string().describe('Repository path'),
  limit: z.number().min(1).max(100).default(10).describe('Maximum number of commits'),
  branch: z.string().optional().describe('Branch name'),
});

export function registerGitLog(server: McpServer, services: Services): void {
  server.registerTool(
    'git_log',
    {
      description: 'Get commit history for a repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          limit: { type: 'number', description: 'Maximum number of commits' },
          branch: { type: 'string', description: 'Branch name' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, limit, branch } = GitLogSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['log', '--format=%H|%an|%ad|%s', '-n', limit.toString()];
      if (branch) args.push(branch);

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_log', repository, error: result.stderr });
        throw new Error(`Git log failed: ${result.stderr}`);
      }

      const commits = services.outputParser.parseLog(result.stdout);

      return {
        content: [{ type: 'text', text: JSON.stringify({ commits }, null, 2) }],
      };
    }
  );
}
