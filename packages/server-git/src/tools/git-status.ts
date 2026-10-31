import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.ts';

const GitStatusSchema = z.object({
  repository: z.string().describe('Repository path'),
});

export function registerGitStatus(server: McpServer, services: Services): void {
  server.registerTool(
    'git_status',
    {
      description: 'Get the current status of a Git repository',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository } = GitStatusSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const result = await services.gitExecutor.execute(
        repository,
        ['status', '--porcelain', '--branch']
      );

      if (!result.success) {
        services.logger?.error({ tool: 'git_status', repository, error: result.stderr });
        throw new Error(`Git status failed: ${result.stderr}`);
      }

      const lines = result.stdout.split('\n');
      const branchLine = lines[0] ?? '';
      const fileLines = lines.slice(1).join('\n');

      const branchMatch = /## ([^\s.]+)/.exec(branchLine);
      const branch = branchMatch ? branchMatch[1] : 'unknown';

      const files = services.outputParser.parseStatus(fileLines);

      return {
        content: [{ type: 'text', text: JSON.stringify({ branch, ahead: 0, behind: 0, files }, null, 2) }],
      };
    }
  );
}
