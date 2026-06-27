import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitFetchSchema = z.object({
  repository: z.string().describe('Repository path'),
  remote: z.string().default('origin').describe('Remote name'),
  branch: z.string().optional().describe('Branch to fetch'),
});

export function registerGitFetch(server: McpServer, services: Services): void {
  server.registerTool(
    'git_fetch',
    {
      description: 'Fetch from remote',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          remote: { type: 'string', description: 'Remote name' },
          branch: { type: 'string', description: 'Branch to fetch' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, remote, branch } = GitFetchSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const args = ['fetch', remote];
      if (branch !== undefined) {
        args.push(branch);
      }

      const result = await services.gitExecutor.execute(repository, args);

      if (!result.success) {
        services.logger?.error({ tool: 'git_fetch', repository, error: result.stderr });
        throw new Error(`Git fetch failed: ${result.stderr}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                remote,
                ...(branch !== undefined && { branch }),
                output: result.stdout || result.stderr,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
