import { type McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Services } from '../core/types.js';

const GitReflogSchema = z.object({
  repository: z.string().describe('Repository path'),
  limit: z.number().int().min(1).max(100).optional().describe('Max entries to return (1-100, default: 20)'),
});

export function registerGitReflog(server: McpServer, services: Services): void {
  server.registerTool(
    'git_reflog',
    {
      description: 'Show recent HEAD movements (reflog)',
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository path' },
          limit: { type: 'integer', description: 'Max entries to return (1-100, default: 20)' },
        },
        required: ['repository'],
      }),
    },
    async (input: unknown) => {
      const { repository, limit = 20 } = GitReflogSchema.parse(input);

      services.repoManager.validateRepository(repository);

      const result = await services.gitExecutor.execute(repository, [
        'reflog',
        '--format=%H|%gd|%gs|%ci',
        '-n',
        String(limit),
      ]);

      if (!result.success) {
        services.logger?.error({ tool: 'git_reflog', repository, error: result.stderr });
        throw new Error(`Git reflog failed: ${result.stderr}`);
      }

      const entries = result.stdout
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [hash, ref, description, date] = line.split('|');
          return {
            hash: hash ?? '',
            ref: ref ?? '',
            description: description ?? '',
            date: date ?? '',
          };
        });

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, entries }, null, 2) }],
      };
    }
  );
}
